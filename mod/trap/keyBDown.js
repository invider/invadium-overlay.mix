function keyBDown(e) {
    if (e.ctrl) return

    log('changing background')
    if (!lab.background) {
        lab.background = '#2a1c31'
        log('background: on')
    } else {
        lab.background = null
        log('background: off')
    }
}
