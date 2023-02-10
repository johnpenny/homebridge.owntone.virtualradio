import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { OwnToneVirtualRadioPlayer, OwnToneVirtualRadioStation } from './platformAccessory';
import fetch from 'node-fetch';
import { readFileSync, writeFileSync } from 'fs';

// NOTE we rely upon required fields with default values in the Settings UI as a core sanity check and guarantee of known fields
// Therefore, non UI configuration of this plugin may cause uncaught errors

export interface IOutput {
    id: number; // owntone ID
    name: string; // HomeKit name serves as the only trusted persistent ID for outputs
    selected: boolean; // selected == active output
    volume: number;
    type: string;
    has_password: boolean;
    requires_auth: boolean;
    needs_auth_key: boolean;
}

export interface ITrack {
    id: number; // owntone ID (not persistently unique, but unique in session)(track ID is DB index - library management will recycle them)
    data_kind: string; // file/url (can be used to filter)
    time_added: string; // "2023-02-02T04:32:22Z" (can be used to fingerprint)
    title: string;
    artist: string;
    album: string;
    genre: string;
}

interface IRadioConfiguration {
    bad: boolean; // if something is found to be wrong, this will flag to unregister/not register
    guid: string;
    context: {
        humanID: string; // a string for humans to discern what this device is - will be its 'Serial Number'
        deviceName: string; // the name in HomeKit - is a changable string (in HomeKit) and should not be relied upon for ID
        room: string;
        outputs: IOutput[];
        notes?: string;
    };
}

interface IStationConfiguration {
    bad: boolean; // if something is found to be wrong, this will flag to unregister/not register
    guid: string;
    context: {
        humanID: string; // a string for humans to discern what this device is - will be its 'Serial Number'
        deviceName: string; // the name in HomeKit - is a changable string (in HomeKit) and should not be relied upon for ID
        track: ITrack;
        notes?: string;
    };
}

export class OwnToneVirtualRadioPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
    public readonly accessories: PlatformAccessory[] = [];

    //

    private readonly storagePath: string; // Homebridge

    private readonly serverAddress: string; // OwnTone
    private availableOutputs: IOutput[] = []; // OwnTone
    private availableStreams: ITrack[] = []; // OwnTone

    private configuredRadios: IRadioConfiguration[] = [];
    private configuredStations: IStationConfiguration[] = [];

    private readonly currentStreamFile: string = 'OwnToneVirtualRadio.CurrentStream.json';

    private readonly lang: string = 'en-gb';
    private readonly txt = {
        'en-gb': {
            'app': {
                'finishedInit': 'Finished initializing platform',
                'started': 'Has started up successfully',
                'aborted': 'Has aborted - Please check the plugin settings!',
            },
            'homebridge': {
                'removeSpare': 'Removing old accessory, as it is no longer valid with your config:',
                'loadFromCache': 'Loading accessory from cache:',
                'restoreFromCache': 'Restoring existing accessory from cache:',
                'removeFromCache': 'Removing existing accessory from cache due to bad configuration:',
                'add': 'Adding new accessory:',
                'newBadConfig': 'A new accessory was found but not set up as it has a bad configuration:',
            },
            'owntone': {
                'api': {
                    'failed': 'The OwnTone server address is incorrect, or the server is down',
                    'response': {
                        'error': 'Got an error from the OwnTone API',
                        'ok': 'Got a good response from the OwnTone API',
                        'bad': 'Got a bad response from the OwnTone API',
                    },
                },
                'get': {
                    'outputs': {
                        'failed': 'Could not get OwnTone outputs due to an error',
                        'notFound': 'This output cannot be found in OwnTone:',
                    },
                    'tracks': {
                        'failed': 'Could not get OwnTone tracks due to an error',
                        'searchedTags': 'Searched for genre tagged tracks and found',
                        'total': 'Total tagged tracks found:',
                        'tooMany': 'You have tagged an enormous number of tracks to create switches for, is this deliberate? Please check the plugin settings!',
                    },
                    'config': {
                        'failed': 'Could not get the OwnTone config due to an error',
                        'radioNoOutputs': 'This virtual radio has no outputs set; It will not be registered:',
                    },
                },
                'output': {
                    'failed': 'Was not able to change an OwnTone output',
                    'on': 'Has turned an OwnTone output ON',
                    'off': 'Has turned an OwnTone output OFF',
                    'reportTitle': 'OwnTone Output Report',
                },
                'player': {
                    'failed': 'Was not able to change the OwnTone player state',
                    'noListeners': 'Found no active outputs in OwnTone',
                    'nothingToPlay': 'Could not find a cached track to auto play; You will need to manually play something in OwnTone in order to hear anything!',
                    'setTrack': 'Set the OwnTone player track',
                    'setTrackFailed': 'Failed to set the track; The track ID is likely no longer valid due to changes in the OwnTone library',
                    'stop': 'Commanded the OwnTone player to STOP',
                    'pause': 'Commanded the OwnTone player to PAUSE',
                    'play': 'Commanded the OwnTone player to PLAY',
                    'next': 'Commanded the OwnTone player to go to the NEXT track',
                    'previous': 'Commanded the OwnTone player to go to the PREVIOUS track',
                    'rewind': 'Commanded the OwnTone player to REWIND the track',
                },
            },
        },
    };

    private readonly hint = { // log hints - colour the text
        'tag': { // tags do not colour text, they hint good/bad [ ✔︎ ]/[ ✘ ] without insinuating critical issues
            'good': '\x1b[47m\x1b[32m ✔︎ \x1b[0m',
            'bad': '\x1b[47m\x1b[31m ✘ \x1b[0m',
        },
        'success': '\x1b[32m%s\x1b[0m', // string styler (styles only the next string %s), use as format arg
        'end': '\x1b[0m', // no style
        'highlight': '\x1b[47m\x1b[30m', // use with end
        'lowlight': '\x1b[38;5;242m', // use with end
    };

    private readonly owntone = {
        'api': { // owntone api endpoints // https://owntone.github.io/owntone-server/json-api/
            'get': { // returns JSON (200)
                'config': '/api/config',
                'outputs': '/api/outputs',
                'playerState': '/api/player',
                'nowPlaying': '/api/queue?id=now_playing',
                'search': {
                    'genre': {
                        'includes': '/api/search?type=tracks&expression=genre+includes+',
                    },
                },
            },
            'post': { // returns JSON (200)
                'queueAdd': '/api/queue/items/add', // returns JSON count
            },
            'put': { // returns nothing (204)
                'stop': '/api/player/stop',
                'play': '/api/player/play',
                'pause': '/api/player/pause',
                'next': '/api/player/next',
                'previous': '/api/player/previous',
                'outputs': '/api/outputs', //  /{id}  with data
            },
            'delete': {}, // returns nothing (204)
        },
    };

    //

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.debug(`${this.txt[this.lang].app.finishedInit} ${this.config.name}`);

        this.serverAddress = `${this.config.owntoneServer.protocol}${this.config.owntoneServer.hostname}${(this.config.owntoneServer.port > 0) ? ':' + this.config.owntoneServer.port : ''}`;

        this.storagePath = api.user.storagePath();

        this.api.on('didFinishLaunching', () => {
            this.Setup();
        });
    }

    private async Setup(): Promise<void> {
        try { // critical API calls - abort setup on any error
            this.availableOutputs = await this.OwnToneGetOutputs(); // get all outputs
            this.availableStreams = await this.OwnToneGetTaggedTracks(); // get tracks matching genre tags in the config
        } catch (e) {
            this.log.error(`${this.txt[this.lang].app.aborted} | ${this.txt[this.lang].owntone.api.failed}`);
            return;
        }

        if (this.config.owntoneServer.outputReporting) {
            this.OwnToneOutputReport();
        }

        this.BuildAccessories();
        this.RegisterAccessories();

        this.log.debug(this.hint.success, this.txt[this.lang].app.started);
    }

    // public methods

    public async OwnToneSetTrack(track: ITrack): Promise<void> {
        let newHead: number;

        try {
            await this.OwnTone('GET', this.serverAddress, this.owntone.api.get.nowPlaying)
                .then((r) => {
                    newHead = (r.items.length > 0) ? r.items[0].position + 1 : 0;
                });
        } catch (e) {
            return; // something went wrong - abort
        }

        try {
            await this.OwnTone('POST', this.serverAddress, `${this.owntone.api.post.queueAdd}?uris=library:track:${track.id}&position=${newHead}`)
                .then((r) => {
                    if (r.count !== 1) {
                        throw new Error('failed');
                    } // we are only adding one track so if 1 isn't returned something went wrong
                });
        } catch (e) {
            this.log.debug(this.hint.tag.bad, this.txt[this.lang].owntone.player.setTrackFailed);
            return; // something went wrong - abort
        }

        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.next);
        } catch (e) {
            return; // something went wrong - abort
        }

        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.play);
        } catch (e) {
            return; // something went wrong - abort
        }

        if (track.data_kind === 'url') {
            await this.OwnToneWriteCurrentStreamFile(track);
        }
    }

    public async OwnToneOutputManager(outputs: IOutput[], switchingOn: boolean): Promise<void> {
        for (const output of outputs) {
            await this.OwnToneOutputSwitcher(output.id, output.name, switchingOn);
        }

        if (switchingOn) {
            await this.OwnToneEnsureSomethingIsPlaying();
            return;
        }

        await this.OwnToneEnsureSomeoneIsListening();
    }

    // private methods

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async OwnTone(method: string, server: string, endpoint: string, data: object = undefined): Promise<any> {
        const o: object = (data) ? { method: method, body: JSON.stringify(data) } : { method: method };

        return await fetch(`${server}${endpoint}`, o)
            .catch((e) => {
                this.log.error(`${this.txt[this.lang].owntone.api.response.error} | ${method} | ${server}${endpoint} | ${e}`);
                throw new Error(e);
            })
            .then((r) => {
                switch (method) {
                    case 'GET':
                    case 'POST':
                    {
                        if (r.status === 200) { // the only useful GET/POST response -- returns JSON
                            this.log.debug(this.hint.tag.good, this.txt[this.lang].owntone.api.response.ok, `| ${method} | ${r.status} ${r.statusText} | ${server}${endpoint}`);
                            return r.json(); // the JSON
                        }
                        break;
                    }
                    case 'PUT':
                    case 'DELETE':
                    {
                        if (r.status === 204) { // the only useful PUT/DELETE response -- returns NOTHING
                            this.log.debug(this.hint.tag.good, this.txt[this.lang].owntone.api.response.ok, `| ${method} | ${r.status} ${r.statusText} | ${server}${endpoint}`);
                            return; // nada
                        }
                        break;
                    }
                }

                // catch & throw all other possible responses as 'bad'
                this.log.error(this.hint.tag.bad, this.txt[this.lang].owntone.api.response.bad, `| ${method} | ${r.status} ${r.statusText} | ${server}${endpoint}`);
                throw new Error(`Bad Response | ${r.status} ${r.statusText}`);
            });
    }

    private async OwnToneGetOutputs(): Promise<IOutput[]> {
        return await this.OwnTone('GET', this.serverAddress, this.owntone.api.get.outputs)
            .catch((e) => {
                this.log.error(`${this.txt[this.lang].owntone.get.outputs.failed} | ${e}`);
                throw new Error(e);
            })
            .then((r) => {
                if (r && r.outputs) {
                    return r.outputs as IOutput[];
                }
            });
    }

    private async OwnToneGetTaggedTracks(): Promise<ITrack[]> {
        let matchingTracks: ITrack[] = [];

        for (const station of this.config.stationSwitches.stations) {
            await this.OwnTone('GET', this.serverAddress, `${this.owntone.api.get.search.genre.includes}"${station.tag}"`)
                .catch((e) => {
                    this.log.error(`${this.txt[this.lang].owntone.get.tracks.failed} | ${e}`);
                    throw new Error(e);
                })
                .then((r) => {
                    // there are no sanity checks here for file/url tracks, any track data type will match
                    if (r && r.tracks.items) {
                        this.log.debug(`${this.txt[this.lang].owntone.get.tracks.searchedTags} ${r.tracks.items.length} '${station.tag}'`);
                        matchingTracks = matchingTracks.concat(r.tracks.items as ITrack[]);
                    }
                });
        }

        this.log.debug(`${this.txt[this.lang].owntone.get.tracks.total} ${matchingTracks.length}`);
        if (matchingTracks.length > 50) {
            this.log.warn(`${this.txt[this.lang].owntone.get.tracks.tooMany} ${this.txt[this.lang].owntone.get.tracks.total} ${matchingTracks.length}`);
        }
        return matchingTracks;
    }

    private async OwnToneGetServerConfig(): Promise<void> {
    // no longer feeding back as there is little useful info here - but a good way to quickly check if the server is alive
        await this.OwnTone('GET', this.serverAddress, this.owntone.api.get.config)
            .catch((e) => {
                this.log.error(`${this.txt[this.lang].owntone.get.config.failed} | ${e}`);
                throw new Error(e);
            });
    }

    private async OwnToneOutputSwitcher(id: number, name: string, switchingOn: boolean): Promise<void> {
        const data = {
            'selected': switchingOn,
        };

        try {
            await this.OwnTone('PUT', this.serverAddress, `${this.owntone.api.put.outputs}/${id}`, data);
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.output.failed} | ${name} | ${e}`);
            return; // something went wrong - abort
        }

        if (switchingOn) {
            this.log.debug(this.hint.tag.good, this.txt[this.lang].owntone.output.on, `| ${name}`);
            return;
        }

        this.log.debug(this.hint.tag.good, this.txt[this.lang].owntone.output.off, `| ${name}`);
    }

    private async OwnToneEnsureSomeoneIsListening(): Promise<void> {
        let outputs: IOutput[];

        try {
            outputs = await this.OwnToneGetOutputs();
        } catch (e) {
            return; // something went wrong - abort
        }

        let hasListener = false; // we want to log all the output statuses, so track whether any are live

        for (const output of outputs) {
            if (output.selected) {
                hasListener = true;
            }
            this.log.debug(`${output.name} | selected: ${(output.selected) ? '\x1b[32m' + output.selected : output.selected }`);
        }

        if (hasListener) {
            return;
        } // we have active listeners

        this.log.debug(this.txt[this.lang].owntone.player.noListeners);

        await this.OwnTonePlayerPause();
    }

    private async OwnTonePlayerPause(): Promise<void> {
        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.pause);
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.player.failed} | ${e}`);
            return; // something went wrong - abort
        }

        this.log.debug(this.txt[this.lang].owntone.player.pause);
    }

    private async OwnTonePlayerPlay(): Promise<void> {
        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.play);
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.player.failed} | ${e}`);
            return; // something went wrong - abort
        }

        this.log.debug(this.txt[this.lang].owntone.player.play);
    }

    private async OwnTonePlayerStop(): Promise<void> {
        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.stop);
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.player.failed} | ${e}`);
            return; // something went wrong - abort
        }

        this.log.debug(this.txt[this.lang].owntone.player.stop);
    }

    private async OwnTonePlayerPrevious(rewind = false): Promise<void> {
    // To use this for 'rewinding' ie moving the TRACK head to the beginning, not going to the previous track, pass 'rewind' true
    // 'previous' call when the track head < 2 seconds skips back one track; head > 2 seconds rewinds the track. we cannot seek with live tracks.
    // we would need to make multiple API calls to know which way to call this cleanly, which is a lot of work vs waiting for the head to pass 2 seconds
    // it certainly seems hacky, but for now it is good enough

        await new Promise(wait => setTimeout(wait, 2000)); // wait 2000 ms before doing anything - read notes above

        try {
            if (rewind) {
                await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.previous); // head seek to 0 (and will not cause live stream error, unlike seek)
                this.log.debug(this.txt[this.lang].owntone.player.rewind);
            } else {
                await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.previous); // head seek to 0 (works with live streams, unlike seek)
                await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.previous); // skip backwards
                this.log.debug(this.txt[this.lang].owntone.player.previous);
            }
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.player.failed} | ${e}`);
            return; // something went wrong - abort
        }
    }

    private async OwnTonePlayerNext(): Promise<void> {
        try {
            await this.OwnTone('PUT', this.serverAddress, this.owntone.api.put.next);
        } catch (e) {
            this.log.error(`${this.txt[this.lang].owntone.player.failed} | ${e}`);
            return; // something went wrong - abort
        }

        this.log.debug(this.txt[this.lang].owntone.player.next);
    }

    private async OwnToneEnsureSomethingIsPlaying(): Promise<void> {
        let empty = true; // is the media slot empty

        try {
            await this.OwnTone('GET', this.serverAddress, this.owntone.api.get.playerState)
                .then((r) => {
                    if (r.item_id > 0) {
                        empty = false;
                    }
                });
        } catch (e) {
            return; // something went wrong - abort
        }

        if (!empty) {
            await this.OwnTonePlayerPlay(); // force play, or the user may think output manager is doing nothing / broken
            return;
        }

        try {
            // set track will fail and log if the track is no longer valid
            await this.OwnToneSetTrack(await this.OwnToneFindSomethingToPlay());
        } catch (e) {
            return; // something went wrong - abort
        }
    }

    private async OwnToneWriteCurrentStreamFile(track: ITrack): Promise<void> {
        writeFileSync(`${this.storagePath}/${this.currentStreamFile}`, JSON.stringify(track)); // save, so we can resume
    }

    private async OwnToneFindSomethingToPlay(): Promise<ITrack> {
        try {
            return JSON.parse(readFileSync(`${this.storagePath}/${this.currentStreamFile}`, 'utf-8')) as ITrack;
        } catch (e) {
            if (this.availableStreams.length > 0) {
                return this.availableStreams[0] as ITrack;
            }
            this.log.error(this.txt[this.lang].owntone.player.nothingToPlay);
            throw new Error('nothing found');
        }
    }

    private OwnToneOutputReport(): void {
        if (this.availableOutputs.length < 1) {
            return;
        }

        let report = `${this.txt[this.lang].owntone.output.reportTitle}:\n`;

        for (const output of this.availableOutputs) {
            report += `\n\t${this.hint.highlight}${output.name}${this.hint.end}\n\tid:${output.id} | type:'${output.type}' | selected:${output.selected}\n\tvolume:${output.volume} | has_password:${output.has_password} | requires_auth:${output.requires_auth} | needs_auth_key:${output.needs_auth_key}\n`;
        }

        this.log.info(report);
    }

    private LogHintChecker(): void {
        this.log.error('this is an error log');
        this.log.warn('this is an warn log');
        this.log.debug('this is an debug log - it will only show when the debug flag is on'); // only shows with debug flag, basically verbose
        this.log.info('this is an info log');
        this.log.info(this.hint.success, 'this is an info log success');
        this.log.info(`this is an info log ${this.hint.lowlight}with lowlight text${this.hint.end}`);
        this.log.info(`this is an info log ${this.hint.highlight}with highlight text${this.hint.end}`);
        this.log.info(this.hint.tag.good, 'this is an info log tag good');
        this.log.info(this.hint.tag.bad, 'this is an info log tag bad');
    }

    // homebridge methods

    configureAccessory(accessory: PlatformAccessory): void {
        this.log.debug(`${this.txt[this.lang].homebridge.loadFromCache} | ${accessory.context.humanID}`);
        this.accessories.push(accessory);
    }

    private BuildAccessories(): void {
        for (const radio of this.config.virtualRadios.radios) {
            const radioConfiguration: IRadioConfiguration = {
                bad: false,
                guid: `${radio.room}.${radio.name}`, // we have very limited options here
                context: {
                    humanID: `${radio.room}.${radio.name}`,
                    deviceName: radio.name as string,
                    room: radio.room as string,
                    outputs: [],
                },
            };

            if (radio.outputs) {
                for (const output of radio.outputs) {
                    const oi: number = this.availableOutputs.findIndex(i => i.name === output.name.trim());
                    if (oi > -1) {
                        radioConfiguration.context.outputs.push(this.availableOutputs[oi]);
                    } else {
                        this.log.warn(`${this.txt[this.lang].owntone.get.outputs.notFound} ${output.name}`);
                        continue;
                    }
                }
            } else {
                this.log.warn(`${this.txt[this.lang].owntone.get.outputs.radioNoOutputs} ${radio.room}.${radio.name}`);
                radioConfiguration.bad = true; // this makes the accessory useless, so mark it bad
                continue;
            }

            if (radioConfiguration.context.outputs.length < 1) {
                radioConfiguration.bad = true;
            } // completely useless, ignore it when registering

            this.configuredRadios.push(radioConfiguration);
        }

        if (this.availableStreams) {
            for (const track of this.availableStreams) {
                const stationConfiguration: IStationConfiguration = {
                    bad: false,
                    guid: `${track.id}.${track.artist}.${track.title}.${track.time_added}`,
                    context: {
                        humanID: `${track.id}.${track.artist}.${track.title}`,
                        deviceName: `${this.config.stationSwitches.stationPrefix} ${track.title}`,
                        track: track,
                    },
                };

                this.configuredStations.push(stationConfiguration);
            }
        }
    }

    private RegisterAccessories(): void {

        for (const radio of this.configuredRadios) {

            const uuid: string = this.api.hap.uuid.generate(radio.guid);
            const eai: number = this.accessories.findIndex(accessory => accessory.UUID === uuid); // existing accessory index
            const existingAccessory: PlatformAccessory = this.accessories[eai]; // get a copy
            this.accessories.splice(eai, 1); // remove it from the cache (as we will be de-registering anything that was left over later as 'spare')

            if (existingAccessory) {
                if (!radio.bad) {
                    this.log.debug(this.hint.tag.good, `${this.txt[this.lang].homebridge.restoreFromCache} ${radio.context.humanID}`);
                    existingAccessory.context = radio.context; // overwrite the context data with newest
                    this.api.updatePlatformAccessories([existingAccessory]); // update context
                    new OwnToneVirtualRadioPlayer(this, existingAccessory); // create accessory
                } else { // was marked bad due to some user config or OwnTone issue
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                    this.log.error(`${this.txt[this.lang].homebridge.removeFromCache} ${radio.context.humanID}`);
                }
            } else { // new
                if (!radio.bad) {
                    this.log.debug(this.hint.tag.good, `${this.txt[this.lang].homebridge.add} ${radio.context.humanID}`);
                    const accessory = new this.api.platformAccessory(radio.context.deviceName, uuid);
                    accessory.context = radio.context;
                    new OwnToneVirtualRadioPlayer(this, accessory);
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                } else {
                    this.log.error(`${this.txt[this.lang].homebridge.newBadConfig} ${radio.context.humanID}`);
                }
            }
        }

        for (const station of this.configuredStations) {

            const uuid: string = this.api.hap.uuid.generate(station.guid);
            const eai: number = this.accessories.findIndex(accessory => accessory.UUID === uuid); // existing accessory index
            const existingAccessory: PlatformAccessory = this.accessories[eai]; // get a copy
            this.accessories.splice(eai, 1); // remove it from the cache (as we will be de-registering anything that was left over later as 'spare')

            if (existingAccessory) {
                if (!station.bad) {
                    this.log.debug(this.hint.tag.good, `${this.txt[this.lang].homebridge.restoreFromCache} ${station.context.humanID}`);
                    existingAccessory.context = station.context; // overwrite the context data with newest
                    this.api.updatePlatformAccessories([existingAccessory]); // update context
                    new OwnToneVirtualRadioStation(this, existingAccessory); // create accessory
                } else { // was marked bad due to some user config or OwnTone issue
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                    this.log.error(`${this.txt[this.lang].homebridge.removeFromCache} ${station.context.humanID}`);
                }
            } else { // new
                if (!station.bad) {
                    this.log.debug(this.hint.tag.good, `${this.txt[this.lang].homebridge.add} ${station.context.humanID}`);
                    const accessory = new this.api.platformAccessory(station.context.deviceName, uuid);
                    accessory.context = station.context;
                    new OwnToneVirtualRadioStation(this, accessory);
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                } else {
                    this.log.error(`${this.txt[this.lang].homebridge.newBadConfig} ${station.context.humanID}`);
                }
            }
        }

        // anything that remains in the cached accessories is something that no longer exists within the configuration - we should deregister it now
        for (const spareAccessory of this.accessories) {
            this.log.debug(`${this.txt[this.lang].homebridge.removeSpare} ${spareAccessory.context.humanID}`);
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [spareAccessory]);
        }
    }
}