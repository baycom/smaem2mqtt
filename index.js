var util=require('util');
var mqtt=require('mqtt');
var hexdump = require('hexdump-nodejs');
const request = require('request');
var Parser = require('binary-parser').Parser;
const commandLineArgs = require('command-line-args')
const dgram = require('dgram');
const socket = dgram.createSocket({'type' : 'udp4', 'reuseAddr' : true});

var errorCounter = 0;

const optionDefinitions = [
	{ name: 'mode', alias: 'M', type: Number, defaultValue: 0 },
	{ name: 'mqtthost', alias: 'm', type: String, defaultValue: "localhost" },
	{ name: 'mqttclientid', alias: 'c', type: String, defaultValue: "smaem1Client" },
	{ name: 'smaemaddr', alias: 'a', type: String, defaultValue: "239.12.255.254"},
	{ name: 'smaemport', alias: 'p', type: String, defaultValue: "9522"},
        { name: 'debug',        alias: 'd', type: Boolean, defaultValue: false }
  ];

const options = commandLineArgs(optionDefinitions)

console.log("SMAEM address    : " + options.smaemaddr + ":" + options.smaemport);
console.log("MQTT Host          : " + options.mqtthost);
console.log("MQTT Client ID     : " + options.mqttclientid);

var MQTTclient = mqtt.connect("mqtt://"+options.mqtthost,{clientId: options.mqttclientid});
	MQTTclient.on("connect",function(){
	console.log("MQTT connected");
})

MQTTclient.on("error",function(error){
		console.log("Can't connect" + error);
		process.exit(1)
	});

function sendMqtt(id, data) {
	let jsonStr = JSON.stringify(data, (key, value) =>
            typeof value === 'bigint'
                ? Number(value)
                : value);
        if(options.debug) {
	        console.log("publish: "+'SMAEM/' + id, jsonStr);
	}
        MQTTclient.publish('SMAEM/' + id, jsonStr);        
}


const SMAEMPayloadParser0 = new Parser()
	.string('SMA', {"length":4, encoding: "iso-8859-15", stripNull: true}) //0
	.uint16be('len') //4-5
	.uint16be('tag') //6-7
	.uint32be('group') //8-11
	;
const SMAEMPayloadParser1 = new Parser()
	.uint16be('len') //12-13
	.uint16be('tag') //14-15
	.uint16be('id') //16-17
	;
const SMAEMPayloadParser2 = new Parser()
	.uint16be('SusyID') //18-19
	.uint32be('SerNo') //20-23
	.uint32be('Ticker') //24-27
	;
const SMAEMPayloadParser3 = new Parser()
	.uint8('channel') //0
	.uint8('index') //1
	.uint8('type') //2
	.uint8('tarif') //3
	;
const SMAEMPayloadParser16 = new Parser()
	.uint16be('value') //0
	;
const SMAEMPayloadParser8 = new Parser()
	.uint8('value') //0
	;
const SMAEMPayloadParser64 = new Parser()
	.uint64be('value') //0
	;
const SMAEMPayloadParser32 = new Parser()
	.uint32be('value') //0
	;


socket.on('error', (err) => {
  console.log(`socket error:\n${err.stack}`);
  socket.close();
});

socket.on('message', (msg, rinfo) => {
  let ret = {};
  if(options.debug) {
  	console.log(hexdump(msg));
  }
  let header0 = SMAEMPayloadParser0.parse(msg);
  if(options.debug) {
  	console.log(util.inspect(header0));
  }
  if(header0.SMA == 'SMA' && header0.len == 4 && header0.tag == 0x02a0 && header0.group == 0x00000001) {
  	let header1 = SMAEMPayloadParser1.parse(msg.slice(12));
  	if(options.debug) {
  		console.log(util.inspect(header1));
	}
  	if(header1.tag == 0x10 && header1.id == 0x6069) {
		let header2 = SMAEMPayloadParser2.parse(msg.slice(18));
		if(options.debug) {
			console.log(util.inspect(header2));
		}
		let buf = msg.slice(28);
		while(buf.length) {
			let header3 = SMAEMPayloadParser3.parse(buf);
			if(options.debug) {
				console.log(util.inspect(header3));
			}
			buf = buf.slice(4);
			if(header3.channel || header3.index || header3.type || header3.tarif) {
				let v = {};
				if(header3.type == 8) {
					v = SMAEMPayloadParser64.parse(buf);
					v.value=Number(v.value)/3600.0;
				} else if(header3.type == 4) {
					v = SMAEMPayloadParser32.parse(buf);
					switch(header3.index) {
						case 13:
						case 14:
						case 31:
						case 32:
						case 33:
						case 51:
						case 52:
						case 53:
						case 71:
						case 72:
						case 73:
							v.value/=1000.0;
							break;
						default: v.value/=10.0;
					}
				} else if(header3.channel == 144) {
					v = SMAEMPayloadParser32.parse(buf);
					buf = buf.slice(4);
				} else if(header3.type == 2) {
					v = SMAEMPayloadParser16.parse(buf);
				} else if(header3.type == 1) {
					v = SMAEMPayloadParser8.parse(buf);
				}
				if(options.debug) {
					console.log(util.inspect(v));
				}
				buf = buf.slice(header3.type);
				let ref = header3.channel+":"+header3.index+"."+header3.type+"."+header3.tarif;
				var obj = {}
				obj[ref] = v.value;
				ret = Object.assign(ret , obj);
			}
		}
		ret = Object.assign(ret, header2);
		sendMqtt(header2.SusyID + "/" + header2.SerNo, ret);
  	}
  } 
});

socket.bind({ 'port' : options.smaemport, 'exclusive' : false }, function() {
        	socket.setMulticastLoopback(true);
        	socket.setMulticastTTL(128);
        	var addr = socket.address();
        	socket.addMembership(options.smaemaddr, addr.address);
});
