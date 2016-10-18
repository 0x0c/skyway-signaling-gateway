const md5 = require('md5')
const EventEmitter = require("events").EventEmitter

const {
  RESPONSE_CREATE_ID,
  RESPONSE_ATTACH,
  RESPONSE_MEDIATYPE,
  RESPONSE_OFFER,
  LONGPOLLING_ATTACHED,
  LONGPOLLING_OFFER,
  LONGPOLLING_ANSWER,
  PLUGIN,
  requestCreateId,
  requestAttach,
  requestMediatype,
  requestOffer,
  requestAnswer,
  requestTrickle,
  requestStreamingList,
  requestStreamingWatch,
  requestStreamingStop,
} = require('./redux-libs/actions')
const util = require('./miscs/util')


/**
 * buffers = {
 *   [id]:{
 *     offer:      [jsep object],
 *     answer:     [jsep object],
 *     type:        <string>,  // "media" or "data"
 *     candidates: [Array of jsep objects],
 *     shouldBuffer: <bool>
 *   }
 * }
 *
 */
class Controller extends EventEmitter {
  constructor(my_peerid, janusStore, Skyway) {
    super(my_peerid, janusStore, Skyway);

    this.my_peerid = my_peerid || 'SSG_komasshu'

    this.buffers = {}
    this.plugins = {}  /* {[id]: "streaming"} */
    this.prevHashes = {}

    this.janusStore = janusStore // store for Janus
    this.skyway = new Skyway({option:{peerid: this.my_peerid}})

    this.skyway.on("opened", ev => {
      this.setSkywayHandler()
      this.setJanusHandler()
    })
  }

  setSkywayHandler() {
    this.skyway.on("receive/offer", (id, offer, type) => {
      let buff = this.buffers[id] || {candidates: [], shouldBuffer: true}
      this.plugins     = Object.assign({}, this.plugins, {[id]: "skywayiot"})
      this.buffers[id] = Object.assign({}, buff, {offer, type})
      this.janusStore.dispatch(requestCreateId(id))
    })

    this.skyway.on("receive/answer", (id, answer) => {
      let buff = this.buffers[id] || {candidates: []}
      this.buffers[id] = Object.assign({}, buff, {answer})
      this.janusStore.dispatch(requestAnswer(id, answer))
    })

    this.skyway.on("receive/candidate", (id, candidate) => {
      let buff = this.buffers[id] || {candidates: [], shouldBuffer: true}

      // before LONGPOLLING_ANSWER, candidates are buffered
      if(buff.shouldBuffer) {
        this.buffers[id] = Object.assign({}, buff, {candidates: [ ...buff.candidates, candidate]})
      } else {
        this.janusStore.dispatch(requestTrickle(id, candidate))
      }
    })
  }

  setJanusHandler() {
    this.janusStore.subscribe(() => {
      // obtain current session state
      let { sessions } = this.janusStore.getState();

      this.emit('sessions_updated', sessions)


      for( let id in sessions ) {
        // obtain session state for this id
        let session = sessions[id]

        // check session has changed of not
        // if it is not changed, simply skip
        // case changed, update prevHash then work procedure
        let prevHash = this.prevHashes[id] || ""
        let currHash = md5(JSON.stringify(JSON.stringify(session)))
        if(prevHash === currHash) {
          console.log(`state not changed, skip procedure for ${id}`)
          continue;
        } else {
          this.prevHashes[id] = currHash
        }

        let is_media = this.buffers[id].type === "media"
        switch(session.status) {
          case RESPONSE_CREATE_ID:
            this.janusStore.dispatch(requestAttach(id, `janus.plugin.${this.plugins[id]}`))
            break;
          case RESPONSE_ATTACH:
            if(this.plugins[id] === "streaming") {
              this.janusStore.dispatch(requestStreamingList(id))
            } else {
              this.janusStore.dispatch(requestMediatype(id, {video: is_media, audio: is_media}))
            }
            break;
          case PLUGIN.STREAMING.RESPONSE_LIST:
            this.janusStore.dispatch(requestStreamingWatch(id, 1))
            break;
          case LONGPOLLING_ATTACHED:
            this.janusStore.dispatch(requestOffer(id, {video: is_media, audio: is_media}, this.buffers[id].offer))
            break;
          case LONGPOLLING_OFFER:
            this.skyway.sendOffer(id, session.offer)
            break;
          case LONGPOLLING_ANSWER:
            this.skyway.sendAnswer(id, session.answer, this.buffers[id].type)

            // lift restriction to buffer candidates
            this.liftBuffer(id)

            // dispatch buffered candidates
            this.buffers[id].candidates.forEach( candidate =>
              this.janusStore.dispatch(requestTrickle(id, candidate))
            )
            break;
          default:
            break;
        }
      }
    })
  }

  liftBuffer(id) {
    this.buffers[id].shouldBuffer = false;
  }

  startStreaming(src) {
    // fixme : check skyway status
    console.dir(this.skyway)
    if(this.skyway.status !== "opened" ) throw "skyway is not opened"

    console.log(`start streaming ${src}`)

    const connection_id = util.createConnectionId("media")
    this.plugins = Object.assign({}, this.plugins, {[connection_id]: "streaming"})
    let buff = this.buffers[connection_id] || {candidates: []}
    this.buffers[connection_id] = Object.assign({}, buff, {type: "media"})

    // since, using streaming plugin does not initiate peer from browser,
    // so we will connection object in SkyWay connector, explicitly
    this.skyway.updatePeerConnection(connection_id, { src, dst: this.my_peerid })
    this.janusStore.dispatch(requestCreateId(connection_id))

  }
}


module.exports = Controller
