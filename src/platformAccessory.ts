import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { OwnToneVirtualRadioPlatform, ITrack, IOutput } from './platform';

export class OwnToneVirtualRadioStation {
    private service: Service;

    constructor(
        private readonly platform: OwnToneVirtualRadioPlatform,
        private readonly accessory: PlatformAccessory,
    ) {

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'uk.johnpenny')
            .setCharacteristic(this.platform.Characteristic.Model, 'Virtual Radio Station Button')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.humanID);

        this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.deviceName);

        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onSet(this.setOn.bind(this))
            .onGet(this.getOn.bind(this));
    }

    async setOn() {
        this.platform.OwnToneSetTrack(this.accessory.context.track as ITrack);
        this.platform.log.debug(`${this.accessory.context.humanID} pressed`);
    }

    async getOn(): Promise<CharacteristicValue> {
        return false; // always off for HomeKit
    }
}

export class OwnToneVirtualRadioPlayer {
    private service: Service;

    private states = {
        on: false,
    };

    constructor(
        private readonly platform: OwnToneVirtualRadioPlatform,
        private readonly accessory: PlatformAccessory,
    ) {

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'uk.johnpenny')
            .setCharacteristic(this.platform.Characteristic.Model, 'Virtual Radio Power Button')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.humanID);

        this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.deviceName);

        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onSet(this.setOn.bind(this))
            .onGet(this.getOn.bind(this));
    }

    async setOn(value: CharacteristicValue) {
        this.states.on = value as boolean;
        this.platform.log.debug(`${this.accessory.context.humanID} ${this.states.on}`);
        this.platform.OwnToneOutputManager(this.accessory.context.outputs as IOutput[], this.states.on);
    }

    async getOn(): Promise<CharacteristicValue> {
        return this.states.on;
    }
}