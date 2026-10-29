(function () {
  'use strict'

  const storageKey = 'squad-dunk-presskit-language'
  let activeTranslation = null
  let activeLanguage = 'en'

  function localizePage (root) {
    if (!activeTranslation) return
    const scope = root || document
    const attributes = ['alt', 'title', 'aria-label', 'aria-roledescription', 'content', 'data-gallery-title']
    const nodes = Array.from(scope.querySelectorAll('[data-l10n]'))
    nodes.forEach(function (node) {
      const value = getPathValue(activeTranslation, node.getAttribute('data-l10n'))
      if (typeof value === 'string') node.textContent = value
    })
    attributes.forEach(function (attribute) {
      const marker = 'data-l10n-' + attribute
      const targets = Array.from(scope.querySelectorAll('[' + marker + ']'))
      if (scope.matches && scope.matches('[' + marker + ']')) targets.push(scope)
      targets.forEach(function (node) {
        const value = getPathValue(activeTranslation, node.getAttribute(marker))
        if (typeof value === 'string') node.setAttribute(attribute, value)
      })
    })
  }

  function screenshotPosition (index, total) {
    const template = getPathValue(activeTranslation, 'ui.carousel.position') || '{current} / {total}'
    return template.replace('{current}', String(index + 1)).replace('{total}', String(total))
  }

  function trackAnalyticsEvent (name, details) {
    if (!name || !window.goatcounter || typeof window.goatcounter.count !== 'function') return

    const eventData = {
      path: name,
      title: details && details.language ? name + ': ' + details.language : name,
      event: true
    }

    try {
      window.goatcounter.count(eventData)
    } catch {
      // Analytics must never interrupt the visitor experience.
    }
  }

  function setupAnalyticsEvents () {
    document.addEventListener('click', function (event) {
      const origin = event.target
      if (!origin || typeof origin.closest !== 'function') return

      const target = origin.closest('[data-analytics-event]')
      if (!target) return

      trackAnalyticsEvent(target.getAttribute('data-analytics-event'))
    })
  }

  function getPathValue (source, path) {
    return path.split('.').reduce(function (value, segment) {
      if (value == null) return undefined
      return value[segment]
    }, source)
  }

  async function readLocalization () {
    const script = document.getElementById('presskit-localization')
    if (!script) return null

    try {
      if (script.dataset.src) {
        const response = await fetch(script.dataset.src, { cache: 'no-cache' })
        if (!response.ok) return null
        return await response.json()
      }
      return JSON.parse(script.textContent)
    } catch (error) {
      return null
    }
  }

  async function setupLanguageSelector () {
    const data = await readLocalization()
    const select = document.querySelector('[data-language-select]')
    if (!data || !select || !Array.isArray(data.languages)) return

    const supported = data.languages.map(function (language) { return language.code })
    const defaultLanguage = data.defaultLanguage || 'en'
    const params = new URLSearchParams(window.location.search)
    const urlLanguage = params.get('lang')
    let storedLanguage = null
    try { storedLanguage = window.localStorage.getItem(storageKey) } catch {}

    function isSupported (language) {
      return supported.indexOf(language) !== -1
    }

    function fallbackLanguage () {
      if (isSupported('en')) return 'en'
      if (isSupported(defaultLanguage)) return defaultLanguage
      return supported[0]
    }

    function normalizeLanguageCode (language) {
      if (typeof language !== 'string') return ''
      return language.trim().toLowerCase().replace('_', '-')
    }

    function matchSupportedLanguage (language) {
      const normalized = normalizeLanguageCode(language)
      if (!normalized) return ''
      if (isSupported(normalized)) return normalized

      const primary = normalized.split('-')[0]
      if (isSupported(primary)) return primary

      return ''
    }

    function detectBrowserLanguage () {
      const browserLanguages = []
      if (window.navigator) {
        if (Array.isArray(window.navigator.languages)) {
          browserLanguages.push.apply(browserLanguages, window.navigator.languages)
        }
        if (window.navigator.language) browserLanguages.push(window.navigator.language)
      }

      for (let i = 0; i < browserLanguages.length; i++) {
        const match = matchSupportedLanguage(browserLanguages[i])
        if (match) return match
      }

      return fallbackLanguage()
    }

    function initialLanguage () {
      const urlMatch = matchSupportedLanguage(urlLanguage)
      if (urlMatch) return urlMatch

      const storedMatch = matchSupportedLanguage(storedLanguage)
      if (storedMatch) return storedMatch

      return detectBrowserLanguage()
    }

    function applyLanguage (language, options) {
      const settings = options || {}
      const selectedLanguage = matchSupportedLanguage(language) || fallbackLanguage()
      activeLanguage = data.translations && data.translations[selectedLanguage] && Object.keys(data.translations[selectedLanguage]).length
        ? selectedLanguage
        : fallbackLanguage()
      activeTranslation = data.translations ? data.translations[activeLanguage] : null

      select.value = selectedLanguage
      document.documentElement.setAttribute('lang', activeLanguage)

      if (settings.persist) {
        try { window.localStorage.setItem(storageKey, selectedLanguage) } catch {}
      }

      if (activeTranslation) {
        localizePage()
        document.querySelectorAll('[data-language-link]').forEach(function (link) {
          const target = new URL(link.getAttribute('href'), window.location.href)
          target.searchParams.set('lang', activeLanguage)
          link.setAttribute('href', target.pathname + target.search + target.hash)
        })
        window.dispatchEvent(new CustomEvent('presskit:languagechange'))
      }

      if (settings.updateUrl && window.history && window.history.replaceState) {
        // Preserve every incoming query parameter, including press outreach UTMs:
        // ?utm_source=email&utm_medium=press&utm_campaign=squad_dunk_announcement
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('lang', selectedLanguage)
        window.history.replaceState({}, '', nextUrl.toString())
      }

      return activeLanguage
    }

    select.addEventListener('change', function () {
      const activeLanguage = applyLanguage(select.value, { updateUrl: true, persist: true })
      trackAnalyticsEvent('Language Changed', { language: activeLanguage })
    })

    applyLanguage(initialLanguage(), { updateUrl: Boolean(urlLanguage), persist: false })
  }

  function setupNavigation () {
    const links = Array.prototype.slice.call(document.querySelectorAll('.nav__item[href^="#"]'))
    if (!links.length) return

    const items = links.map(function (link) {
      const id = decodeURIComponent(link.getAttribute('href').slice(1))
      return {
        id,
        link,
        section: document.getElementById(id)
      }
    }).filter(function (item) {
      return item.section
    })

    if (!items.length) return

    function setActive (id) {
      items.forEach(function (item) {
        const active = item.id === id
        item.link.classList.toggle('is-active', active)
        if (active) {
          item.link.setAttribute('aria-current', 'true')
        } else {
          item.link.removeAttribute('aria-current')
        }
      })
    }

    function updateActive () {
      const probe = Math.max(120, window.innerHeight * 0.22)
      let current = items[0]

      for (let i = 0; i < items.length; i++) {
        const rect = items[i].section.getBoundingClientRect()
        if (rect.top <= probe && rect.bottom > probe) {
          current = items[i]
          break
        }
        if (rect.top <= probe) current = items[i]
      }

      setActive(current.id)
    }

    let ticking = false
    function requestUpdate () {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(function () {
        updateActive()
        ticking = false
      })
    }

    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        const id = decodeURIComponent(link.getAttribute('href').slice(1))
        const target = document.getElementById(id)
        if (!target) return

        event.preventDefault()
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (window.history && window.history.pushState) {
          window.history.pushState({}, '', '#' + id)
        }
        setActive(id)
      })
    })

    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    updateActive()
  }

  function setupLandingHero () {
    const nav = document.querySelector('.landing-nav')
    const hero = document.querySelector('.landing-hero')
    if (!nav || !hero) return

    function updateLandingState () {
      const threshold = Math.min(120, Math.max(48, hero.offsetHeight * 0.12))
      nav.classList.toggle('is-scrolled', window.scrollY > threshold)
    }

    let ticking = false
    function requestUpdate () {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(function () {
        updateLandingState()
        ticking = false
      })
    }

    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    updateLandingState()
  }

  function setupYoutubeEmbeds () {
    const trigger = document.querySelector('[data-video-trigger]')
    const frame = document.querySelector('[data-youtube-src]')
    const container = document.querySelector('.landing-video__frame')
    if (!trigger || !frame || !container) return

    trigger.addEventListener('click', function () {
      const source = frame.getAttribute('data-youtube-src')
      if (!source) return

      const separator = source.indexOf('?') === -1 ? '?' : '&'
      frame.setAttribute('src', source + separator + 'autoplay=1&origin=' + encodeURIComponent(window.location.origin))
      container.classList.add('is-playing')
    })
  }

  // The trailer shows a still until it is asked for, then loads YouTube's player and plays.
  // Links marked data-trailer-open ("Watch the trailer") scroll to it and start it too.
  function setupTrailer () {
    const player = document.querySelector('[data-trailer]')
    if (!player) return

    function play () {
      if (player.querySelector('iframe')) return
      const frame = document.createElement('iframe')
      frame.src = 'https://www.youtube.com/embed/' + player.getAttribute('data-youtube-id') + '?autoplay=1&rel=0&playsinline=1'
      frame.title = document.getElementById('trailer-title') ? document.getElementById('trailer-title').textContent : 'Trailer'
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      frame.allowFullscreen = true
      frame.referrerPolicy = 'strict-origin-when-cross-origin'
      player.innerHTML = ''
      player.appendChild(frame)
    }

    const start = player.querySelector('[data-trailer-play]')
    if (start) start.addEventListener('click', play)

    document.querySelectorAll('[data-trailer-open]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        player.scrollIntoView({ behavior: 'smooth', block: 'center' })
        play()
      })
    })
  }

  // Hand-picked community posts from community.json. The section stays hidden until it has one.
  // Each card shows a thumbnail and only loads the platform's player when clicked.
  const communityPlatforms = {
    youtube: {
      name: 'YouTube',
      url: function (item) { return 'https://www.youtube.com/watch?v=' + item.id },
      embed: function (item) { return 'https://www.youtube.com/embed/' + item.id + '?autoplay=1&rel=0&playsinline=1' },
      // Shorts have a portrait oardefault; hq720 is a true 16:9 frame. Older uploads only have
      // the letterboxed hqdefault, which still crops well to either shape.
      thumb: function (item) { return 'https://i.ytimg.com/vi/' + item.id + (item.vertical ? '/oardefault.jpg' : '/hq720.jpg') },
      fallback: function (item) { return 'https://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg' }
    },
    tiktok: {
      name: 'TikTok',
      url: function (item) { return 'https://www.tiktok.com/' + item.author + '/video/' + item.id },
      embed: function (item) { return 'https://www.tiktok.com/player/v1/' + item.id + '?autoplay=1&rel=0' }
    },
    instagram: {
      name: 'Instagram',
      url: function (item) { return 'https://www.instagram.com/reel/' + item.id + '/' },
      embed: function (item) { return 'https://www.instagram.com/reel/' + item.id + '/embed/' }
    }
  }

  const communityIcons = {
    views: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5m0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9m0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4"/></svg>'
  }

  function communityStat (icon, count) {
    const stat = document.createElement('span')
    stat.className = 'community__stat'
    stat.setAttribute('data-community-count', count)
    stat.innerHTML = icon
    stat.appendChild(document.createElement('span'))
    return stat
  }

  async function setupCommunity () {
    const section = document.querySelector('[data-community]')
    const list = section && section.querySelector('[data-community-list]')
    if (!list) return

    let items = []
    let listUrl = window.location.href
    try {
      const response = await fetch(section.dataset.src, { cache: 'no-cache' })
      if (response.ok) {
        items = await response.json()
        listUrl = response.url
      }
    } catch (error) {}
    items = Array.isArray(items) ? items.filter(function (item) { return communityPlatforms[item.platform] && item.id }) : []
    // A clip cross-posted on several platforms shows once; its other copies still count in the total.
    const cards = items.filter(function (item) { return !item.duplicateOf })
    if (!cards.length) return

    cards.forEach(function (item) {
      const platform = communityPlatforms[item.platform]
      const li = document.createElement('li')
      li.className = 'community__item' + (item.vertical || item.platform !== 'youtube' ? ' community__item--vertical' : '')

      const media = document.createElement('div')
      media.className = 'community__media'
      const start = document.createElement('button')
      start.type = 'button'
      start.className = 'community__start'
      start.setAttribute('aria-label', (item.title || platform.name) + ' — ' + item.author)
      start.setAttribute('data-analytics-event', 'Community Play')
      const thumb = item.thumb ? new URL(item.thumb, listUrl).href : (platform.thumb && platform.thumb(item))
      if (thumb) {
        const img = document.createElement('img')
        img.src = thumb
        img.alt = ''
        img.loading = 'lazy'
        if (!item.thumb && platform.fallback) {
          img.addEventListener('error', function () { img.src = platform.fallback(item) }, { once: true })
        }
        start.appendChild(img)
      } else if (item.title) {
        const text = document.createElement('span')
        text.className = 'community__text'
        text.textContent = item.title
        start.appendChild(text)
      }
      start.insertAdjacentHTML('beforeend', '<span class="community__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>')

      // View count, as of the last refresh.
      if (item.views) {
        const stats = document.createElement('span')
        stats.className = 'community__stats'
        stats.appendChild(communityStat(communityIcons.views, item.views))
        start.appendChild(stats)
      }
      start.addEventListener('click', function () { openCommunityPlayer(platform.embed(item), item.title || platform.name, start, item.platform) })
      media.appendChild(start)

      // Credit the creator and link to the original post.
      const credit = document.createElement('a')
      credit.className = 'community__credit'
      credit.href = item.url || platform.url(item)
      credit.target = '_blank'
      credit.rel = 'noopener'
      credit.setAttribute('data-analytics-event', 'Community Credit Click')
      credit.textContent = item.author + ' · ' + platform.name

      li.appendChild(media)
      li.appendChild(credit)
      list.appendChild(li)
    })
    // Headline figure: every view added up, rounded down so it never overstates ("240K+").
    const total = section.querySelector('[data-community-total]')
    if (total) {
      const sum = items.reduce(function (acc, item) { return acc + (item.views || 0) }, 0)
      const unit = Math.pow(10, Math.max(0, String(Math.round(sum)).length - 2))
      total.setAttribute('data-community-count', Math.floor(sum / unit) * unit)
      total.setAttribute('data-community-suffix', '+')
      total.appendChild(document.createElement('span'))
    }
    section.hidden = false
    formatCommunityCounts()
    setupCommunityCarousel(list, section.querySelector('[data-community-viewport]') || list)
    new MutationObserver(formatCommunityCounts).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }

  // Articles about DUNK from press.json (written by tools/radar/press.mjs), newest first.
  // Each card links out to the article; headlines stay in the outlet's own language.
  async function setupPress () {
    const section = document.querySelector('[data-press]')
    const list = section && section.querySelector('[data-press-list]')
    if (!list) return

    let items = []
    let listUrl = window.location.href
    try {
      const response = await fetch(section.dataset.src, { cache: 'no-cache' })
      if (response.ok) {
        items = await response.json()
        listUrl = response.url
      }
    } catch (error) {}
    items = Array.isArray(items) ? items.filter(function (item) { return item.url && item.title }) : []
    if (!items.length) return

    items.forEach(function (item) {
      const li = document.createElement('li')
      li.className = 'press__item'
      const link = document.createElement('a')
      link.className = 'press__card'
      link.href = item.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.setAttribute('data-analytics-event', 'Press Article Click')

      const media = document.createElement('span')
      media.className = 'press__media'
      const img = document.createElement('img')
      img.alt = ''
      img.loading = 'lazy'
      if (item.thumb) {
        img.src = new URL(item.thumb, listUrl).href
        media.appendChild(img)
      } else {
        // No image from the outlet: the key art, dimmed, with the outlet's name on top.
        img.src = 'images/key-art-2026-web.jpg'
        media.classList.add('press__media--plain')
        media.appendChild(img)
        const name = document.createElement('span')
        name.className = 'press__media-name'
        name.textContent = item.outlet
        media.appendChild(name)
      }

      const meta = document.createElement('span')
      meta.className = 'press__meta'
      const outlet = document.createElement('span')
      outlet.className = 'press__outlet'
      outlet.textContent = item.outlet
      meta.appendChild(outlet)
      if (item.lang) {
        const lang = document.createElement('span')
        lang.className = 'press__lang'
        lang.textContent = item.lang.toUpperCase()
        meta.appendChild(lang)
      }
      if (item.date) {
        const date = document.createElement('time')
        date.className = 'press__date'
        date.dateTime = item.date
        meta.appendChild(date)
      }

      const title = document.createElement('span')
      title.className = 'press__title'
      title.textContent = item.title
      if (item.lang) title.lang = item.lang

      link.appendChild(media)
      link.appendChild(meta)
      link.appendChild(title)
      li.appendChild(link)
      list.appendChild(li)
    })

    const languages = new Set(items.map(function (item) { return item.lang }).filter(Boolean))
    section.querySelector('[data-press-articles]').textContent = items.length
    section.querySelector('[data-press-languages]').textContent = languages.size
    section.hidden = false
    formatPressDates()
    new MutationObserver(formatPressDates).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

    // Arrows step one card; touch and trackpads scroll the row natively.
    const prev = section.querySelector('[data-press-prev]')
    const next = section.querySelector('[data-press-next]')
    function update () {
      const overflow = list.scrollWidth > list.clientWidth + 1
      prev.hidden = !overflow || list.scrollLeft <= 1
      next.hidden = !overflow || list.scrollLeft >= list.scrollWidth - list.clientWidth - 1
    }
    function step (direction) {
      const card = list.firstElementChild
      list.scrollBy({ left: direction * (card.offsetWidth + 16), behavior: 'smooth' })
    }
    prev.addEventListener('click', function () { step(-1) })
    next.addEventListener('click', function () { step(1) })
    list.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
  }

  function formatPressDates () {
    let format
    try {
      format = new Intl.DateTimeFormat(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    } catch (error) {
      format = { format: function (date) { return date.toISOString().slice(0, 10) } }
    }
    document.querySelectorAll('.press__date').forEach(function (node) {
      node.textContent = format.format(new Date(node.dateTime + 'T12:00:00Z'))
    })
  }

  // The most-viewed clip sits in the middle with the next ones on either side (2nd to its right,
  // 3rd to its left, and so on), so the best clips are always in view. The row only sways a little
  // around that spot; arrows step one card, and the row swipes (touch) or drags (mouse) by hand.
  function setupCommunityCarousel (list, viewport) {
    const prev = viewport.querySelector('[data-community-prev]')
    const next = viewport.querySelector('[data-community-next]')
    const ranked = Array.from(list.children)
    const left = ranked.filter(function (card, index) { return index > 0 && index % 2 === 0 }).reverse()
    const right = ranked.filter(function (card, index) { return index % 2 === 1 })
    left.concat([ranked[0]], right).forEach(function (card) { list.appendChild(card) })

    if (list.scrollWidth <= list.clientWidth + 1) {
      if (prev) prev.hidden = true
      if (next) next.hidden = true
      return
    }
    setupCommunityDrag(list)
    list.classList.add('is-swaying')

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const period = 9 // seconds for one sway back and forth
    function cardStep () {
      return ranked[0].offsetWidth + parseFloat(getComputedStyle(list).columnGap || 16)
    }
    function clamp (x) {
      return Math.max(0, Math.min(list.scrollWidth - list.clientWidth, x))
    }
    let base = clamp(ranked[0].offsetLeft + ranked[0].offsetWidth / 2 - list.clientWidth / 2)
    let position = base
    let target = null // where an arrow click is gliding to
    let phase = 0
    let paused = 0
    let last = null
    list.scrollLeft = base

    function go (direction) {
      if (target === null) position = list.scrollLeft
      base = clamp((target === null ? position : target) + direction * cardStep())
      target = base
      phase = 0
    }
    if (prev) prev.addEventListener('click', function () { go(-1) })
    if (next) next.addEventListener('click', function () { go(1) })

    function hold () { paused++ }
    function release () { paused = Math.max(0, paused - 1) }
    viewport.addEventListener('mouseenter', hold)
    viewport.addEventListener('mouseleave', release)
    list.addEventListener('touchstart', hold, { passive: true })
    list.addEventListener('touchend', release)
    viewport.addEventListener('focusin', hold)
    viewport.addEventListener('focusout', release)
    list.addEventListener('pointerdown', function () { target = null })

    function step (time) {
      const dt = last === null ? 0 : Math.min(time - last, 100)
      if (target !== null) {
        position += (target - position) * Math.min(1, dt / 110)
        if (Math.abs(target - position) < 0.5) { position = target; target = null; phase = 0 }
        list.scrollLeft = position
      } else if (!paused && !reduced && !document.hidden && !document.body.classList.contains('has-community-player')) {
        phase += dt / 1000
        const amplitude = Math.min(36, cardStep() * 0.2)
        list.scrollLeft = clamp(base + amplitude * Math.sin(phase / period * 2 * Math.PI))
      } else {
        // Held or moved by hand: sway again from wherever the row is now.
        base = list.scrollLeft
        phase = 0
      }
      last = time
      window.requestAnimationFrame(step)
    }
    window.requestAnimationFrame(step)
  }

  // On-page player: a dimmed overlay with the clip at phone shape, so visitors never leave the page.
  let communityPlayer = null
  function openCommunityPlayer (src, title, opener, platform) {
    if (!communityPlayer) {
      const overlay = document.createElement('div')
      overlay.className = 'community-player'
      overlay.hidden = true
      overlay.setAttribute('role', 'dialog')
      overlay.setAttribute('aria-modal', 'true')
      overlay.innerHTML = '<div class="community-player__frame"></div>' +
        '<button class="community-player__close" type="button" data-l10n-aria-label="ui.landing.close" aria-label="Close video">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg></button>'
      document.body.appendChild(overlay)
      const close = function () {
        overlay.hidden = true
        overlay.querySelector('.community-player__frame').innerHTML = ''
        document.body.classList.remove('has-community-player')
        if (communityPlayer.opener) communityPlayer.opener.focus()
      }
      overlay.addEventListener('click', function (event) { if (event.target === overlay) close() })
      overlay.querySelector('.community-player__close').addEventListener('click', close)
      document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !overlay.hidden) close() })
      communityPlayer = { overlay: overlay, opener: null }
      localizePage(overlay)
    }
    const frame = document.createElement('iframe')
    frame.src = src
    frame.title = title
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    frame.allowFullscreen = true
    frame.referrerPolicy = 'strict-origin-when-cross-origin'
    communityPlayer.opener = opener
    const box = communityPlayer.overlay.querySelector('.community-player__frame')
    box.setAttribute('data-platform', platform)
    box.appendChild(frame)
    communityPlayer.overlay.setAttribute('aria-label', title)
    communityPlayer.overlay.hidden = false
    document.body.classList.add('has-community-player')
    communityPlayer.overlay.querySelector('.community-player__close').focus()
  }

  // Mouse users can grab the row and drag it; a drag never counts as a click on a card.
  function setupCommunityDrag (list) {
    let startX = 0
    let startScroll = 0
    let dragging = false
    let moved = false

    list.addEventListener('dragstart', function (event) { event.preventDefault() })
    list.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      dragging = true
      moved = false
      startX = event.clientX
      startScroll = list.scrollLeft
    })
    window.addEventListener('pointermove', function (event) {
      if (!dragging) return
      const dx = event.clientX - startX
      if (Math.abs(dx) > 5) {
        moved = true
        list.classList.add('is-dragging')
      }
      if (moved) list.scrollLeft = startScroll - dx
    })
    window.addEventListener('pointerup', function () {
      dragging = false
      list.classList.remove('is-dragging')
    })
    list.addEventListener('click', function (event) {
      if (!moved) return
      moved = false
      event.preventDefault()
      event.stopPropagation()
    }, true)
  }

  // "2.7K" / "2,7 mil" / "2670" depending on the active language.
  function formatCommunityCounts () {
    let format
    try {
      format = new Intl.NumberFormat(document.documentElement.lang || 'en', { notation: 'compact', maximumFractionDigits: 1 })
    } catch (error) {
      format = { format: String }
    }
    document.querySelectorAll('[data-community-count]').forEach(function (stat) {
      stat.lastChild.textContent = format.format(Number(stat.getAttribute('data-community-count'))) + (stat.getAttribute('data-community-suffix') || '')
    })
  }

  function setupScreenshotCarousels () {
    document.querySelectorAll('[data-carousel]').forEach(function (carousel) {
      const track = carousel.querySelector('[data-carousel-track]')
      const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'))
      const thumbs = Array.from(carousel.querySelectorAll('[data-carousel-thumb]'))
      const navigation = carousel.querySelector('[data-carousel-navigation]')
      const count = carousel.querySelector('[data-carousel-count]')
      if (!track || !slides.length) return

      let current = 0
      let scheduled = false
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

      function update (index) {
        current = index
        count.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0')
        count.setAttribute('aria-label', screenshotPosition(index, slides.length))
        thumbs.forEach(function (thumb, i) {
          thumb.setAttribute('aria-pressed', String(i === index))
        })
        const active = thumbs[index]
        if (active) {
          const rail = active.parentElement
          if (active.offsetLeft < rail.scrollLeft || active.offsetLeft + active.offsetWidth > rail.scrollLeft + rail.clientWidth) {
            rail.scrollTo({ left: active.offsetLeft - rail.clientWidth / 2 + active.offsetWidth / 2, behavior: reducedMotion.matches ? 'auto' : 'smooth' })
          }
        }
      }

      function go (index) {
        const target = (index + slides.length) % slides.length
        track.scrollTo({ left: target * track.clientWidth, behavior: reducedMotion.matches ? 'auto' : 'smooth' })
      }

      carousel.querySelector('[data-carousel-prev]').addEventListener('click', function () { go(current - 1) })
      carousel.querySelector('[data-carousel-next]').addEventListener('click', function () { go(current + 1) })
      thumbs.forEach(function (thumb, index) { thumb.addEventListener('click', function () { go(index) }) })
      track.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        go(current + (event.key === 'ArrowRight' ? 1 : -1))
      })
      track.addEventListener('scroll', function () {
        if (scheduled) return
        scheduled = true
        window.requestAnimationFrame(function () {
          update(Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / track.clientWidth))))
          scheduled = false
        })
      }, { passive: true })
      new ResizeObserver(function () {
        track.scrollTo({ left: current * track.clientWidth, behavior: 'auto' })
      }).observe(track)
      navigation.hidden = false
      window.addEventListener('presskit:languagechange', function () { update(current) })
      update(0)
    })
  }

  function setupGalleryLightbox () {
    const links = Array.prototype.slice.call(document.querySelectorAll('[data-gallery="screenshots"]'))
    if (!links.length) return

    const items = links.map(function (link) {
      const image = link.querySelector('img')
      return {
        element: link,
        href: link.getAttribute('href'),
        title: link.getAttribute('data-gallery-title') || link.getAttribute('title') || '',
        alt: image ? image.getAttribute('alt') || '' : ''
      }
    }).filter(function (item) {
      return item.href
    })

    if (!items.length) return

    let currentIndex = 0
    let returnFocus = null
    const lightbox = document.createElement('div')
    lightbox.className = 'gallery-lightbox'
    lightbox.setAttribute('role', 'dialog')
    lightbox.setAttribute('aria-modal', 'true')
    lightbox.setAttribute('data-l10n-aria-label', 'ui.viewer.label')
    lightbox.innerHTML = [
      '<div class="gallery-lightbox__dialog">',
      '  <figure class="gallery-lightbox__figure">',
      '    <img class="gallery-lightbox__image" alt="">',
      '  </figure>',
      '  <div class="gallery-lightbox__caption">',
      '    <span class="gallery-lightbox__title"></span>',
      '    <span class="gallery-lightbox__count"></span>',
      '    <a class="gallery-lightbox__download" download data-l10n="ui.media.original">Original ↗</a>',
      '  </div>',
      '  <button class="gallery-lightbox__button gallery-lightbox__close" type="button" data-l10n-aria-label="ui.viewer.close">×</button>',
      '  <button class="gallery-lightbox__button gallery-lightbox__prev" type="button" data-l10n-aria-label="ui.carousel.previous">‹</button>',
      '  <button class="gallery-lightbox__button gallery-lightbox__next" type="button" data-l10n-aria-label="ui.carousel.next">›</button>',
      '</div>'
    ].join('')

    document.body.appendChild(lightbox)
    localizePage(lightbox)

    const image = lightbox.querySelector('.gallery-lightbox__image')
    const title = lightbox.querySelector('.gallery-lightbox__title')
    const count = lightbox.querySelector('.gallery-lightbox__count')
    const download = lightbox.querySelector('.gallery-lightbox__download')
    const closeButton = lightbox.querySelector('.gallery-lightbox__close')
    const prevButton = lightbox.querySelector('.gallery-lightbox__prev')
    const nextButton = lightbox.querySelector('.gallery-lightbox__next')

    function render () {
      const item = items[currentIndex]
      image.setAttribute('src', item.href)
      image.setAttribute('alt', item.element.querySelector('img').getAttribute('alt'))
      title.textContent = item.element.getAttribute('data-gallery-title')
      count.textContent = (currentIndex + 1) + ' / ' + items.length
      count.setAttribute('aria-label', screenshotPosition(currentIndex, items.length))
      download.setAttribute('href', item.href)
    }

    function open (index) {
      currentIndex = index
      returnFocus = document.activeElement
      render()
      lightbox.classList.add('is-open')
      document.body.classList.add('gallery-lightbox-open')
      closeButton.focus()
    }

    function close () {
      lightbox.classList.remove('is-open')
      document.body.classList.remove('gallery-lightbox-open')
      if (returnFocus) returnFocus.focus({ preventScroll: true })
    }

    function move (direction) {
      currentIndex = (currentIndex + direction + items.length) % items.length
      render()
    }

    links.forEach(function (link, index) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        open(index)
      })
    })

    closeButton.addEventListener('click', close)
    prevButton.addEventListener('click', function () { move(-1) })
    nextButton.addEventListener('click', function () { move(1) })
    window.addEventListener('presskit:languagechange', function () {
      if (lightbox.classList.contains('is-open')) render()
    })

    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) close()
    })

    document.addEventListener('keydown', function (event) {
      if (!lightbox.classList.contains('is-open')) return

      if (event.key === 'Tab') {
        const focusable = [download, closeButton, prevButton, nextButton]
        const index = focusable.indexOf(document.activeElement)
        event.preventDefault()
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus()
      }

      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
    })
  }

  function setupHeroVideo () {
    const video = document.querySelector('[data-hero-video]')
    if (!video) return
    const toggle = document.querySelector('[data-hero-toggle]')
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function setPaused (paused) {
      if (paused) video.pause()
      else video.play().catch(function () {})
      if (!toggle) return
      toggle.setAttribute('aria-pressed', paused ? 'true' : 'false')
      toggle.setAttribute('data-l10n-aria-label', paused ? 'ui.hero.play' : 'ui.hero.pause')
      localizePage(toggle)
    }

    // The Chinese build of the announcement video has the Chinese logo and call to action.
    function syncSource () {
      const suffix = activeLanguage === 'zh' && video.getAttribute('data-src-zh') ? 'zh' : 'default'
      const src = video.getAttribute('data-src-' + suffix)
      if (video.getAttribute('src') === src) return
      const wasPaused = video.paused
      video.setAttribute('poster', video.getAttribute('data-poster-' + suffix))
      const ambient = document.querySelector('[data-hero-ambient]')
      if (ambient) ambient.style.backgroundImage = "url('" + video.getAttribute('data-poster-' + suffix) + "')"
      video.setAttribute('src', src)
      if (!wasPaused || !reduceMotion) video.play().catch(function () {})
    }

    if (toggle) toggle.addEventListener('click', function () { setPaused(!video.paused) })
    window.addEventListener('presskit:languagechange', syncSource)
    syncSource()
    if (reduceMotion) setPaused(true)
  }

  // Images with a Chinese version (the 友尽大扣篮 logo) swap in when the page is in Chinese.
  function setupLocalizedImages () {
    const images = Array.prototype.slice.call(document.querySelectorAll('img[data-src-zh]'))
    if (!images.length) return
    images.forEach(function (img) {
      img.setAttribute('data-src-default', img.getAttribute('src'))
      img.setAttribute('data-alt-default', img.getAttribute('alt') || '')
    })

    function sync () {
      const suffix = activeLanguage === 'zh' ? 'zh' : 'default'
      images.forEach(function (img) {
        const src = img.getAttribute('data-src-' + suffix)
        if (img.getAttribute('src') === src) return
        img.setAttribute('src', src)
        img.setAttribute('alt', img.getAttribute('data-alt-' + suffix) || img.getAttribute('data-alt-default'))
        img.removeAttribute('width')
        img.removeAttribute('height')
      })
    }
    window.addEventListener('presskit:languagechange', sync)
    sync()
  }

  // Key art windows: each PSD layer moves at its own speed while the window crosses the screen.
  function setupScenes () {
    const scenes = Array.prototype.slice.call(document.querySelectorAll('[data-scene]'))
    if (!scenes.length) return
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const items = scenes.map(function (scene) {
      return {
        scene: scene,
        layers: Array.prototype.slice.call(scene.querySelectorAll('[data-depth]')).map(function (layer) {
          return { element: layer, depth: parseFloat(layer.getAttribute('data-depth')) || 0 }
        })
      }
    })

    function update () {
      const viewport = window.innerHeight
      items.forEach(function (item) {
        const rect = item.scene.getBoundingClientRect()
        if (rect.bottom < -100 || rect.top > viewport + 100) return
        // -1 when the window enters at the bottom, 1 when it leaves at the top.
        const progress = Math.max(-1, Math.min(1, (viewport / 2 - (rect.top + rect.height / 2)) / ((viewport + rect.height) / 2)))
        item.layers.forEach(function (layer) {
          layer.element.style.transform = 'translate3d(0,' + (-progress * layer.depth * rect.height).toFixed(1) + 'px,0)'
        })
      })
    }

    let ticking = false
    function requestUpdate () {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(function () {
        update()
        ticking = false
      })
    }

    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    update()
  }

  // Arriving with a #section (e.g. from the home page's press links): the browser's own jump
  // happens before the language is applied and is lost, so land on the section once set up.
  function scrollToInitialHash () {
    const id = decodeURIComponent(window.location.hash.slice(1))
    const target = id && document.getElementById(id)
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' })
  }

  document.addEventListener('DOMContentLoaded', async function () {
    setupAnalyticsEvents()
    await setupLanguageSelector()
    setupNavigation()
    setupLandingHero()
    setupHeroVideo()
    setupLocalizedImages()
    setupScenes()
    setupYoutubeEmbeds()
    setupTrailer()
    setupCommunity()
    setupPress()
    setupScreenshotCarousels()
    setupGalleryLightbox()
    scrollToInitialHash()
  })
}())
