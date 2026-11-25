import test from 'node:test';
import assert from 'node:assert/strict';
import {baudRate,pickSerialPort,SERIAL_BAUD_RATES} from '../../server/src/expression-engine/ActionDevices.ts';

const port=(vendor?:number,product?:number,name='')=>({name,getInfo:()=>({usbVendorId:vendor,usbProductId:product})});

test('baud rate comes from the Named Device, 9600 when blank or bad',()=>{
 assert.equal(baudRate({BaudRate:'115200'}),115200);
 assert.equal(baudRate({BaudRate:38400}),38400);
 assert.equal(baudRate({}),9600);
 assert.equal(baudRate({BaudRate:'abc'}),9600);
 assert.deepEqual([...SERIAL_BAUD_RATES],['9600','19200','38400','57600','115200']);
});

test('built-in COM ports (no USB ids) are told apart by their number',()=>{
 const ports=[port(undefined,undefined,'COM1'),port(0x0483,0x5740,'USB'),port(undefined,undefined,'COM2')];
 assert.equal(pickSerialPort(ports,'serial:0000:0000')?.name,'COM1');
 assert.equal(pickSerialPort(ports,'serial:0000:0000:1')?.name,'COM2');
 assert.equal(pickSerialPort(ports,'serial:0483:5740')?.name,'USB');
 assert.equal(pickSerialPort(ports,'serial:0000:0000:9')?.name,'COM1');
 assert.equal(pickSerialPort(ports,'serial:1111:2222'),undefined);
});
