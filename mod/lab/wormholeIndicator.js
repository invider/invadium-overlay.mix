/*
 * Wormhole Universal Process Indicator
 *
 * Could work as a stopwatch, timer or air raid alert indicator.
 *
 */
'use strict'

// bootloader states
const LOADING       = 'loading'
const BLACKOUT      = 'blackout'
const HOLDING       = 'holding'
const FADING        = 'fading'
const WAITING       = 'waiting'
const SELF_DESTRUCT = 'self-destruct'

// default bootloader configuration
// replace any value by creating config.json in the root mod
// and defining the "boot": {} structure there
const df = {
    time: {
        power:       1.5, // timing when the "Powered By" label appears
        hold:        3.5,
        fade:        1,
        wait:       .5,
        blackout:    2,   // how long fade in lasts after bootloader reset()
        labelFadeIn: 1,   // timing for the label fade in effect
    },
    color: {
        base:         '#000000',
        content:      hsl(.54, 1, .5),   // default blue
        contentTest:  hsl(.17, 1, .55),  // TODO how to enable it for tests?
        contentErr:   hsl(.01, 1, .55),  // error red
        contentDebug: hsl(.1, 1, .5),    // debug orange
        contentOK:    hsl(.39, .9, .6),  // OK green
        fadeBase:     '#000000',
    },
    sfx: {
        boot: {
           res: 'boot',
           vol: .75,
        },
        error: {
            res: 'bootError',
            vol: 1,
        },
        vol:  .75,
    },
}

let cf = {}

// boot state
let bootState = LOADING
let bootTimer = 0
let stateTimer = 0
let bootLabel = ''


// boot implementation values
const BASE = rx(1) > ry(1)? ry(1) : rx(1)
const FBASE = BASE * .04

let labelFont = FBASE+'px moon'
let lowFont = FBASE*.75 + 'px moon'

const R3 = ry(.4)
const POWERED_BY = 'Powered by Collider.JAM'
const DEVELOPING_WITH = 'Developing with Collider.JAM'
const ERROR = 'Error'

const ALERT              = 'Alert!'
const ALERT_MESSAGE      = 'Air Raid Alert[REGION]! Proceed to the nearest shelter!'
const ALERT_OVER         = 'Over!'
const ALERT_OVER_MESSAGE = 'The Air Raid Alert is Over!'

const ACTIVE = 0
const FADE_IN = 1
const FADE_OUT = 2
const STABLE = 5

const RING = 0
const CONNECTOR = 1
const LABEL = 3

const DEAD = 11

const FQ = 5
const DIR = 0

let x = rx(.5)
let y = ry(.5)
const R1 = BASE * .075
const R2 = BASE * .2

const SPEED = BASE * 5
const RSPEED = TAU*2
const TSPEED = BASE * .5
const STEP = (R2-R1)/15
const STEPV = 2
const W = BASE * .003

const FADE = 1.2
const TEXT_FADE_OUT = 2

const MIN_ANGLE = 0.2
const MAX_ANGLE = PI/2

const worms = []
const targets = []

function init() {
    bootTimer  = 0
    stateTimer = 0

    cf = augment({}, df)
    if (env.config.boot) {
        const bt = env.config.boot
        augment(cf, bt)
    }
    if (env.config.debug) {
        if (!env.config.slowBoot) {
            cf.time.hold  = 0  // no hold on debug
            cf.time.power = 0  // show the label right away
        }
    }

    if (env.config.war) {
        checkAlert()
        setInterval( checkAlert, 5000 )
    }
}

function reset() {
    if ($.boot === this) return false // already booting!
    init()
    worms.length = 0
    stateTimer   = 0
    bootState    = BLACKOUT
    bootLabel    = ''
    spawnedPoweredBy = false

    $.boot = this
    return true
}

const wormTrait = {
    evo: function (dt) {
        let activeSegments = 0
        let killAt = -1
        this.sg.forEach((segment, i) => {
            segment.evo(dt)
            if (segment.state < DEAD) activeSegments ++
            else killAt = i
        })
        if (activeSegments === 0) {
            this.kill()
        } else if (killAt >= 0) {
            this.sg.splice(killAt, 1)
        }
    },
    draw: function() {
        this.sg.forEach(segment => segment.draw())
    },
    kill: function() {
        this.state = DEAD
    },
}

let outerRingWorms = 0

function spawnTextSegment(worm, st) {
    const sg = extend({
        state:   FADE_IN,
        time:    0,
        fadein:  0,
        keep:    0,
        fadeout: 0,
        rx:     .5,
        ry:     .5,
        x:       0,
        y:       0,
        dir:     0,
        msg:     '...',

        evo: function(dt) {
            if (this.state === DEAD) return

            this.time += dt
            if (this.state === FADE_OUT && this.time >= this.fadeout) this.state = DEAD
        },

        draw: function(dt) {
            if (this.state === DEAD) return

            save()
            switch(this.state) {
                case FADE_IN:
                    alpha(min(this.time/this.fadein, 1))
                    if (this.time >= this.fadein) {
                        this.time = 0
                        this.state = ACTIVE
                    }
                    break

                case ACTIVE:
                    alpha(1)
                    if (this.keep && this.time >= this.keep) {
                        this.time = 0
                        this.state = FADE_OUT
                    }
                    break

                case FADE_OUT:
                    alpha(max(1 - this.time/this.fading, 0))
                    break
            }

            if (this.font) font(this.font)
            else font(lowFont)
            fill(cf.color.content)
            baseMiddle()
            if (this.dir < 0) alignLeft()
            else if (this.dir > 0) alignRight()
            else alignCenter()

            text(this.msg, this.rx? rx(this.rx) : this.x, this.ry? ry(this.ry) : this.y)
            restore()
        },
    }, st)

    worm.sg.push(sg)
    return sg
}

function spawnLineSegment(worm, x1, y1, x2, y2, onTarget) {
    const length = lib.math.distance(x1, y1, x2, y2)
    const targetTime = length/TSPEED

    const sg = {
        state: ACTIVE,
        time: 0,
        worm: worm,
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        length: length,
        targetTime: targetTime,
        onTarget: onTarget,

        evo: function(dt) {
            this.time += dt
            if (this.state === ACTIVE && this.time >= this.targetTime) {
                this.time = 0
                this.state = FADE_OUT
                if (this.onTarget) this.onTarget(this)
            }
            if (this.state === FADE_OUT && this.time >= FADE) {
                this.state = DEAD
            }
        },

        draw: function() {
            if (this.state === DEAD) return

            save()
            if (this.state === FADE_OUT) {
                alpha(1 - this.time/FADE)
            }

            const a = lib.math.bearing(this.x1, this.y1, this.x2, this.y2)

            let l = this.length
            if (this.state === ACTIVE) l = this.time/this.targetTime * this.length

            lineWidth(W)
            stroke(st.color.content)
            line(this.x1, this.y1, this.x1 + sin(a)*l, this.y1 + cos(a)*l)

            restore()
        },
    }
    worm.sg.push(sg)
    return sg
}

function spawnSegment(worm, type, orbit, angle, target) {
    let dir = DIR
    if (dir === 0) dir = ~~(Math.random() * 2 + 1) - 2

    const sg = {
        state: ACTIVE,
        time: 0,
        worm: worm,
        type: type,
        orbit: orbit,
        dir: dir,
        angle: angle,
        shift: 0,
        target: target,

        onTarget: function() {
            this.state = FADE_OUT

            // spawn next segment
            switch(this.type) {
            case RING:
                if (this.orbit >= R2) {
                    // end of the ring
                    outerRingWorms ++
                    /*
                    if (outerRingWorms === 1) {
                        showPoweredBy(this)
                        return 
                    }
                    */

                    //targets.push('/hero-' + outerRingWorms + '.png')

                    if (targets.length > 0) {
                        const label = targets.pop()
                        const a = this.angle
                        const len = this.orbit + rnd(BASE*.1, BASE*.2)

                        spawnLineSegment(this.worm,
                            x + cos(a) * this.orbit,
                            y + sin(a) * this.orbit,
                            x + cos(a) * len,
                            y + sin(a) * len,
                            function(t) {
                                let len = rnd(rx(.05), rx(.4)-R2)
                                if (t.x1 > t.x2) len *= -1

                                spawnLineSegment(t.worm,
                                    t.x2, t.y2,
                                    t.x2 + len, t.y2,
                                    function(t) {
                                        let dir = 0
                                        let sx = 0
                                        if (len < 0) {
                                            dir = 1
                                            sx -= BASE*.01
                                        } else {
                                            dir = -1
                                            sx += BASE*.01
                                        }
                                        const sg = spawnTextSegment(t.worm, {
                                            x:       t.x2 + sx,
                                            y:       t.y2,
                                            dir:     dir,
                                            msg:     label,
                                            fadein:  TEXT_FADE_OUT,
                                            keep:    0,
                                            fadeout: 0,
                                        })
                                    })
                            }
                        )
                    }
                    return
                }

                if (this.dir < 0) {
                    spawnSegment(this.worm, CONNECTOR, this.orbit,
                        this.angle - this.shift, STEP * RND(1, STEPV))
                } else {
                    spawnSegment(this.worm, CONNECTOR, this.orbit,
                        this.angle + this.shift, STEP * RND(1, STEPV))
                }
                break;

            case CONNECTOR:
                spawnSegment(this.worm, RING, this.orbit + this.target, this.angle,
                        rnd(MIN_ANGLE, MAX_ANGLE))
                break;
            }

            this.target = 1
        },

        evo: function(dt) {
            if (this.state === DEAD) return

            this.time += dt
            if (this.state === FADE_OUT) {
                this.target -= dt/FADE
                if (this.target <= 0) this.state = DEAD
                return
            }

            switch (this.type) {
            case RING: this.shift += RSPEED * dt; break;
            case CONNECTOR: this.shift += SPEED * dt; break;
            case LABEL:
                if (!this.state === STABLE && this.time > this.target) this.state = DEAD
                break;
            }

            if (this.shift >= this.target) {
                this.shift = this.target
                this.onTarget()
            }
        },

        draw: function() {
            if (this.state === DEAD) return

            save()
            if (this.state === FADE_OUT) {
                alpha(this.target)
            }

            lineWidth(W)
            stroke(cf.color.content)

            switch(this.type) {
            case RING:
                if (this.dir < 0) {
                    arc(x, y, this.orbit, this.angle-this.shift, this.angle)
                } else {
                    arc(x, y, this.orbit, this.angle, this.angle + this.shift)
                }
                break;

            case CONNECTOR:
                line(
                    x + cos(this.angle) * this.orbit,
                    y + sin(this.angle) * this.orbit,
                    x + cos(this.angle) * (this.orbit + this.shift),
                    y + sin(this.angle) * (this.orbit + this.shift)
                )
                break;

            case LABEL:
                if (this.state === STABLE) {
                    alpha(max(this.time/FADE, 1))
                } else {
                    let a = this.time/this.target
                    if (a < .5) a *= 2
                    else a = min(1 - (a-0.5)*2, 0)
                    alpha(a)
                }

                if (this.font) font(this.font)
                else font(lowFont)
                fill(cf.color.content)
                baseMiddle()
                if (this.dir < 0) alignLeft()
                else if (this.dir > 0) alignRight()
                else alignCenter()

                text(this.label, this.orbit, this.angle)
                break;
            }
            restore()
        },
    }
    worm.sg.push(sg)
    return sg
}

function spawnWorm() {
    // find a fossil
    let worm = false
    worms.forEach(w => {
        if (w.state === DEAD) worm = w
    })

    if (!worm) {
        worm = extend({}, wormTrait) // no fossil found, so create a new one
        worms.push(worm)
    }

    augment(worm, {
        state: ACTIVE,
        sg: [],
    })

    spawnSegment(worm, RING, R1, 1, 2)
    return worm
}

let spawnedPoweredBy = false
function evoContent(dt) {
    if (![BLACKOUT, LOADING, HOLDING].includes(bootState)) return

    worms.forEach(w => {
        if (w.state < DEAD) w.evo(dt)
    })

    // spawn
    if (rnd() < FQ * dt) {
        spawnWorm()
    }

    /*
    // spawn powered by
    if (!spawnedPoweredBy && bootTimer > cf.time.power) {
        const w = spawnWorm()

        let msg = POWERED_BY
        if (env.config.alert) {
            const leadRegion = env.alertRegion
            msg = ALERT_MESSAGE.replace('[REGION]', ` in ${leadRegion.alias || leadRegion.name || ''}`)
        } else if (env.config.debug) {
            msg = DEVELOPING_WITH
        }
        spawnTextSegment(w, {
            name:    'poweredBy',
            rx:      .5,
            ry:      .9,
            dir:     0,
            msg:     msg, 
            fadein:  1,
            keep:    0,
            fadeout: 0,
        })
        spawnedPoweredBy = true
    }
    */
    //loading += dt/10
}

function drawContent() {
    // anchor to the center of the screen
    x = rx(.5)
    y = ry(.5)

    ctx.lineCap = 'round'
    worms.forEach(w => {
        if (w.state < DEAD) w.draw()
    })

    save()
    alpha( bootTimer > cf.time.labelFadeIn? 1 : bootTimer / cf.time.labelFadeIn )
    font(labelFont)
    fill(cf.color.content)
    alignCenter()
    baseMiddle()
    text(bootLabel, x, y)
    restore()
}

// ************************
// generic bootloader logic

function updateLoadingStatus() {
    let loaded = this._.___.res._loaded
    let included = this._.___.res._included

    let amount = 1
    if ([BLACKOUT, LOADING, HOLDING].includes(bootState)) {
        // we are faking percentage to include time left to hold
        if (cf.time.hold === 0) {
            amount = min(loaded/included, 1)
        } else {
            const holdRate = min(stateTimer/cf.time.hold, 1)
            amount = min((loaded/included + holdRate)/2, 1)
        }
    }

    if (env.config.debug) {
        cf.color.content = cf.color.contentDebug
    }

    if (env.config.alert) {
        // air raid alert
        bootLabel = ALERT
        cf.color.content = cf.color.contentErr
    } else if (env.config.alertOver) {
        bootLabel = ALERT_OVER
        cf.color.content = cf.color.contentOK
    } else if (res._errors) {
        // a boot-time error
        if (bootLabel !== ERROR) {
            const sound = !res.sfx || res.sfx[cf.sfx.error.res]
            if (sound) sfx(sound, cf.sfx.error.vol || cf.sfx.vol)
        }
        bootLabel = ERROR
        cf.color.content = cf.color.contentErr
    } else {
        // calculate the loading status in %
        const percent = Math.floor(amount * 100)
        bootLabel = `${percent}%`
    }
}

function evoBoot(dt) {
    bootTimer += dt
    stateTimer += dt

    switch (bootState) {
    case BLACKOUT:
        if (stateTimer >= cf.time.blackout) {
            stateTimer = 0
            bootState = HOLDING
        }
        break

    case HOLDING:
        break;

    case FADING:
        if (stateTimer >= cf.time.fade) {
            stateTimer = 0
            bootState = WAITING 
        }
        break;

    case WAITING:
        if (stateTimer >= cf.time.wait) {
            bootState = SELF_DESTRUCT 
        }
        break;

    case SELF_DESTRUCT:
        kill(this)
        delete $.boot
        $._boot = this
        trap('postBoot')
        break;
    }
}

function evo(dt) {
    this.evoBoot(dt)
    //if (!this.canvasFixed) return
    this.evoContent(dt)
}

function draw() {
    /*
    if (bootState === WAITING || bootState === SELF_DESTRUCT) {
        background(cf.color.fadeBase)
        return
    }
    */

    // hide what is behind
    if (bootState === BLACKOUT) {
        // note, that the background fading is accumulative,
        // since we are not rendering the scene behind
        // and drawing a semitransparent background on top over and over again
        alpha( cf.time.blackout? stateTimer/cf.time.blackout : 0)
    }
    //background(cf.color.base)
    if (!lab.background) {
        ctx.clearRect(0, 0, ctx.width, ctx.height)
    }

    //if (!this.canvasFixed) return

    save()

    this.updateLoadingStatus()

    drawContent()

    if (bootState === FADING) {
        alpha( stateTimer/cf.time.fade )
        background(cf.color.fadeBase)
    }

    restore()
}

function getStatus() {
    return {
        bootState,
        stateTimer,
        loaded: this._.___.res._loaded,
        included: this._.___.res._included,
    }
}

function forEachSegment(fn) {
    const acc = []
    worms.forEach(worm => {
        if (worm.dead) return
        worm.sg.forEach(sg => {
            if (sg.state === DEAD) return
            fn(sg, acc)
        })
    })
    return acc
}

function raiseAlert(leadRegion) {
    env.config.alert = true
    env.alertRegion = leadRegion
    if (!$.boot) {
        $._boot.reset()
    } else {
        const message = ALERT_MESSAGE.replace('[REGION]', ` in ${leadRegion.alias || leadRegion.name || ''}`)
        replacePoweredMessage(message)
    }
}

function alertIsOver() {
    env.config.alert = false
    env.config.alertOver = true
    replacePoweredMessage(ALERT_OVER_MESSAGE)
}

function replacePoweredMessage(newMessage) {
    // find "poweredBy" message segment
    const segments = forEachSegment((sg, acc) => {
        if (sg.name === 'poweredBy') {
            acc.push(sg)
        }
    })
    if (segments.length > 0) {
        const poweredBySegment = segments[0]
        poweredBySegment.msg = newMessage
    }
}

function checkAlert() {
    // TODO work with a different flag
    if (!env.config.war) return

    fetch('/war', {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
    })
    .then(response => response.json())
    .then(regions => {
        const monitorRegions = env.config.war.toLowerCase().split(',').map(e => e.trim())

        const targetRegions = []
        Object.keys(regions).forEach(regionKey => {
            const region = regions[regionKey]

            monitorRegions.forEach(monitoringName => {
                if (regionKey === monitoringName
                        || region.name.toLowerCase() === monitoringName
                        || (region.alias && region.alias.toLowerCase() === monitoringName)) {
                    targetRegions.push(region)
                }
            })
        })

        let alertNow   = false
        let leadRegion = null
        targetRegions.forEach(region => {
            if (region.alertnow) {
                alertNow = true
                if (!leadRegion) {
                    leadRegion = region
                }
            }
        })

        if (alertNow) {
            if (!env.config.alert) raiseAlert(leadRegion)
        } else {
            if (env.config.alert) {
                alertIsOver()
            }
        }
    })
}
