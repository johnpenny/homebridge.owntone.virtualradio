<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge – OwnTone – Virtual Radio

## What Does It Do?
- It creates virtual 'Radio' devices that can be placed in appropriate rooms, and activated via Siri
    - It links these radio devices to the OwnTone compatible outputs you desire
- It automatically creates switches to change the radio station by matching a track's genre field in OwnTone

## Why?
- Because many live radio services are not available on HomeKit devices
    - Some are also only available via 'Personal Requests' with Siri, which is not suitable for most households

## How Do I Use It?
- Install OwnTone and link some outputs (please check these work first)
- You will need to know the address/hostname, port, and protocol of your OwnTone server
- You will need the exact names of your speakers - which you can get via the plugin, read on
- Install this Homebridge plugin
    - Open the plugin and check the 'OwnTone Server' section is all correct, leave 'OwnTone Output Reporting' checked
        - Restart Homebridge and look in the log for the "OwnTone Output Report:"
            - Use these exact names to configure the radio outputs in the plugin settings
    - You will need to modify the track genre field of tracks you wish to generate switches for; adding a tag in the genre field
        - You will need to input these tags in the plugin settings
    - You may turn of 'OwnTone Output Reporting' in the 'OwnTone Server' section of the settings if you want it gone
    - You may view a verbose log of everything the plugin is doing by turning on 'Homebridge Debug Mode -D' in the 'Homebridge Settings' panel (top right ⋮)

## How Do I Tag Tracks?
Look in the /misc/'Example Radio Playlists' directory for example playlists with some tracks pre-tagged.

For an .m3u playlist your genre field will be '#EXTGENRE:' and within this field you should add your tag, as below:
```
#EXTINF:-1, BBC Radio - Four
#EXTALB: Live Broadcast
#EXTGENRE: Live Radio [hovr] <--- THIS IS THE GENRE TAG - USE BRACKETS AND UNIQUE TAGS TO AVOID FALSE MATCHES
http://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-syndication-high/proto/http/transferformat/hls/vpid/bbc_radio_fourfm
```
You may use multiple tags. So if you wish to use these BBC Radio playlists you can simply drop them in to OwnTone, and use the default tag of [hovr] for them, then you can devise your own tag such as [siri] to add to your own playlists. Just make sure you add the tag [siri] in the plugin settings!

To view the genre field within OwnTone click on the vertical elipsis icon on a track '⋮' and you can view all the track details.

Keep in mind that if you tag non stream tracks, they will not loop or do anything clever, they will just play out and the queue will move on. Only streams will keep going.

## Using Defaults, What Are The Siri Commands?
### Virtual Radio Switch Control
While in the same room (to affect that room only):
> Hey Siri turn on the Radio

> Hey Siri switch on the Radio

While anywhere (to affect a named room only):
> Hey Siri turn on the Radio in the NAMED room

> Hey Siri switch on the Radio in the NAMED room

While anywhere (to affect all switches):
> Hey Siri turn on the Radio everywhere

> Hey Siri switch on the Radio everywhere

### Radio Station Switch Control
While anywhere:
> Hey Siri turn on Radio Six Music

> Hey Siri switch on Radio Six Music

> Hey Siri turn on Radio Four

> Hey Siri switch on Radio Four

DO NOT SAY: (NOTE that using 'to' is not valid)
> Hey Siri switch to Radio Six Music

NOTE: saying 'BBC Radio'+'anything' causes all of my Apple devices to play 'BBC Radio Stoke from tunein' and I have no idea why – this is why my BBC playlists don't have track names prefixed with 'BBC', if you were wondering.

## Limitations
### With Homebridge / HomeKit
- Homebridge can only manage a maximum of 150 devices unless you run multiple bridges; keep this in mind when adding station switches
- Each station button must be a stand alone switch device in HomeKit due to the way sub-accessories are handled with Siri - I hope at some point they can be combined and work cleanly with Siri commands, but for now It does not seem possible
### With OwnTone
- Only one radio station will play on all speakers (If anyone wants multiple OwnTone server support please say)
- Anyone with access to OwnTone can change what is playing, the linked speakers will not disconnect dependant on media source
- OwnTone 'hogs' an output; if you play something else on the output, it will be immediately replaced by OwnTone again. Turn the output off in OwnTone to stop this
- Paired HomePods do not behave in the way you would expect with OwnTone. They will show as two outputs, and their physical volume buttons send a pause/play command
- Pause/Play, Next/Previous commands do not behave as expected with OwnTone. Pause/Play will work when the delay between them is short. Next/Previous will not work correctly

## Anticipated Questions & Answers
- Q: Can you add playlist/artist/genre/album stations?
    - A: Yes, but due to the limitations on device numbers and lack of natural language input I have not yet coded it. Let me know if you want it
- Q: Why not use playlists?
    - A: I wrote a basic version of this with playlists a while ago, but quickly hit limits and needed granular control of station switch generation. Even my BBC Radio playlists total 60+ stations, and most of them I do not want day-to-day, so I moved to a tagging system
- Q: Can I use these BBC Radio playlists from anywhere?
    - A: I do not know, try it. Only a couple of stations have notes about geo-locking. I recommend 'Radio Four' and 'Radio Six Music' if you do try them
- Q: Can I use this to just make OwnTone on/off switches for my rooms, then use the web UI to play anything I want?
    - A: Yes; You can name the 'Virtual Radios' anything you want and use them for OwnTone output control
- Q: Does this mess up my OwnTone queue?
    - A: It should not, if it does please report it to me. It places the stream track in the next queue slot and skips to it, so it should not cause issues
- Q: Why are you not using room prefixing to indicate the room?
    - A: I was, it stopped working at some point during christmas 2022. Now I just name the switches 'Radio' and print the room details within the Serial Number
- Q: Will this play a stream forever, wasting my bandwidth?
    - A: No, when you turn off an output there is a check for other active outputs. If nothing is receiving then the stream is paused
        - Note if outputs have been selected by you, and they have no link to a virtual radio, then they will never be affected by this plugin and the stream may play forever
        - Note the HTTP stream is not an output and will be paused if there is no active output

## Device Management
### Virtual Radio Switches
To identify a Virtual Radio Switch, in HomeKit (Home App) view the 'Serial Number' of the device.

You will manage, configure, add, and remove these via the plugin settings.

### Radio Station Switches
To identify a Radio Station Switch, in HomeKit (Home App) view the 'Serial Number' of the device.

Your radio station switches are NOT managed in the plugin settings; They are automatically generated by the plugin platform.

The plugin searches for 'genre tags' in your OwnTone library. To add or remove a station switch you should edit the track within OwnTone to add or remove the genre tag.

You can add additional tags to search for, or edit the tags, in the plugin settings.

To avoid frustration and avoid losing HomeKit device settings, such as exclusion from favourites or views, you will want to avoid changing tracks, as when they are changed a fresh device will be created, with all the default settings.

To understand how the plugin platform automatically manages your station switches you must first note the GUID structure:

GUID structure: {track.id}.{track.artist}.{track.title}.{track.time_added}

###### A new switch will be made when
- A tagged track with a new GUID is found
- If you change any of the track fields that make up the GUID; this will be seen as a new track needing a new switch, the old one will be removed

###### A switch will be restored upon restart when
- An existing switch GUID matches a found tagged track

###### A switch will be removed upon restart when
- An existing switch GUID does NOT match any found tagged track

###### No switch management will be done when
- Your OwnTone server is down; the plugin should abort and not affect your devices

###### If you wish to remove all switches without removing the plugin
- Press the red bin icon at the bottom left of the plugin settings and then press save; all switches will be removed upon a restart, the plugin will no longer run, but it will remain installed
