/**
 * echo test sample
 *
 */

const net = require('net')
const util = require('../libs/miscs/util')
const log4js = require('log4js')

const logger = log4js.getLogger('join-leave')

const CONF = require('../conf/janus.json')
const port = CONF['external']['tcp_port']


const MESG = {
  "JOIN": new Buffer("SSG:room/join,testroom"),
  "LEAVE": new Buffer("SSG:room/leave,testroom")
}



let client = new net.Socket()

client.connect(port, '127.0.0.1')

client.on('connect', () => {
  logger.info("connected to ssg");

  const joindata = Buffer.concat([util.CONTROL_ID, MESG.JOIN])
  const leavedata = Buffer.concat([util.CONTROL_ID, MESG.LEAVE])

  logger.info("send join")
  client.write(joindata)

  process.on('SIGINT', () => {
    logger.info("send leave")
    client.write(leavedata)
    process.exit()
  });
})

client.on('data', (buff) => {
  let handle_id = buff.slice(0, 8)
  let data = buff.slice(8).toString();

  logger.debug(`recv - ${handle_id.toString("hex")}: ${data}`)
  const mesg = JSON.stringify({"topic": "presence", "payload": "echo"})
  const echo_mesg = Buffer.concat([handle_id, new Buffer(mesg)])
  client.write(echo_mesg)
})


