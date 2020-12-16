var debug = require('debug')('Service');
var Characteristic = require('./Characteristic.js').Characteristic;
var messages = require('./messages.js');

module.exports = {
  Service: Service
};

/*
 * Homebridges -> Homebridge -> Accessory -> Service -> Characteristic
 */

function Service(devices, context) {
  // console.log("Service", devices);
  this.iid = devices.iid;
  this.type = devices.type.substring(0, 8);
  
  this.aid = context.aid;
  this.host = context.host;
  this.port = context.port;
  this.hb_name = context.hb_name;
  this.info = context.info;
  this.characteristics = {};
  this.id = this.hb_name + "_" + this.aid + "_" + this.iid;
  devices.characteristics.forEach(function(element) {
    var service = new Characteristic(element, this);
    if (element.type.substring(0, 8) === '00000023' && element.description === "Name") {
      this.name = element.value;
    } else {
      if (this.characteristics[service.description]) {
        // debug("Duplicate", this.name, service.description);
      } else {
        // debug("Adding", this.name, service.iid, service.description);
        this.characteristics[service.description] = service;
      }
    }
  }.bind(this));
}

Service.prototype.getDeviceCapabilities = function(context) {
  var capabilities = [];

  if (this.name) {
    context.name = this.name;
  }

  for (var index in this.characteristics) {
    var characteristic = this.characteristics[index];
    if (characteristic.type !== '00000023' && characteristic.capabilities) {
      capabilities = capabilities.concat(characteristic.capabilities);
    }
  }

  if (capabilities.length > 0) {
    return ({
      id: this.id,
      name: context.name,
      description: this.hb_name + " " + context.name,
      type: messages.lookupDeviceType(this.type),
      capabilities: capabilities,
      device_info: {
        manufacturer: context.manufacturer
      }
    });
  }
};

Service.prototype.getDeviceState = function(homebridge) {
  return new Promise((resolve, reject) => {

    var device_state = {
      id: this.id,
      capabilities: []
    };

    var cc = Object.keys(this.characteristics).filter(char => this.characteristics[char].type !== '00000023' && this.characteristics[char].capabilities.length > 0).flatMap((characteristic_name) => {
      var characteristic = this.characteristics[characteristic_name];
      return new Promise((resolve, reject) => 
        homebridge.HAPstatus(this.host, this.port, `?id=${characteristic.aid}.${characteristic.iid}`, (err, value) => { 
          characteristic.value = value.characteristics[0].value; 
          var converted_capability_state = messages.convertHomeBridgeValueToAliceValue(characteristic.capabilities[0], characteristic);
          if(err)
            resolve({
              id: this.id,
              error_code: converted_capability_state.error_code,
              error_message: converted_capability_state.error_message
            })
          resolve({
            id: this.id,
            capabilities: [converted_capability_state]
          });
        })
      )
    })
    Promise.all(cc).then((data) => resolve(data))
  })
}

Service.prototype.getCharacteristicIidAndValueFromCapability = function(request_capability_data) {
  for (var index in this.characteristics) {
    var characteristic_data = this.characteristics[index];
    if (characteristic_data.type !== '00000023' && characteristic_data.capabilities) {
      for(var i = 0; i < characteristic_data.capabilities.length; i++) {
        var service_capability = characteristic_data.capabilities[i];

        if (service_capability.type == request_capability_data.type) {
          // we found request capability
          var converted_value = messages.convertAliceValueToHomeBridgeValue(request_capability_data);

          if (converted_value.error_code) {
            return converted_value;
          }

          return {
            aid: characteristic_data.aid,
            iid: characteristic_data.iid,
            value: converted_value.value,
          };
        }
      }
    }
  }

  // no such capability found
  return {
    error_code: "INVALID_ACTION",
    error_message: "Requested capability is not found for requested Homebridge Device"
  };
}
