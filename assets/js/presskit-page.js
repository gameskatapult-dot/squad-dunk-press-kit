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
      embed: function (item) { return 'https://www.instagram.com/reel/' + item.id + '/embed' }
    }
  }

  async function setupCommunity () {
    const section = document.querySelector('[data-community]')
    const list = section && section.querySelector('[data-community-list]')
    if (!list) return

    let items = []
    try {
      const response = await fetch(section.dataset.src, { cache: 'no-cache' })
      if (response.ok) items = await response.json()
    } catch (error) {}
    items = Array.isArray(items) ? items.filter(function (item) { return communityPlatforms[item.platform] && item.id }) : []
    if (!items.length) return

    items.forEach(function (item) {
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
      const thumb = item.thumb || (platform.thumb && platform.thumb(item))
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

      // View count (or likes where the platform hides views), as of when the post was added.
      const count = item.views || item.likes
      if (count) {
        const stat = document.createElement('span')
        stat.className = 'community__stat'
        stat.setAttribute('data-community-count', count)
        stat.innerHTML = item.views
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5m0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9m0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21"/></svg>'
        stat.appendChild(document.createElement('span'))
        start.appendChild(stat)
      }
      start.addEventListener('click', function () {
        const frame = document.createElement('iframe')
        frame.src = platform.embed(item)
        frame.title = item.title || platform.name
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
        frame.allowFullscreen = true
        frame.referrerPolicy = 'strict-origin-when-cross-origin'
        media.innerHTML = ''
        media.appendChild(frame)
      })
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
    section.hidden = false
    formatCommunityCounts()
    setupCommunityCarousel(list)
    new MutationObserver(formatCommunityCounts).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }

  // Endless drift: the cards are cloned once and the row scrolls slowly, wrapping at the halfway
  // point. It still swipes and drags by hand, pauses on hover/touch, and stops for good once a
  // clip is playing or when the visitor prefers reduced motion.
  function setupCommunityCarousel (list) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (list.scrollWidth <= list.clientWidth + 1) return

    const originals = Array.from(list.children)
    originals.forEach(function (item) {
      const clone = item.cloneNode(true)
      clone.setAttribute('aria-hidden', 'true')
      clone.querySelectorAll('a, button').forEach(function (el) { el.tabIndex = -1 })
      list.appendChild(clone)
    })
    // Clones lose their listeners, so playing goes through the original card's button.
    list.addEventListener('click', function (event) {
      const start = event.target.closest('.community__start')
      if (!start || !start.closest('[aria-hidden="true"]')) return
      const index = Array.from(list.children).indexOf(start.closest('li')) - originals.length
      const original = originals[index] && originals[index].querySelector('.community__start')
      if (!original) return
      const clone = start.closest('li')
      const offset = clone.offsetLeft - originals[index].offsetLeft
      position -= offset
      list.scrollLeft = position
      original.click()
    })
    list.classList.add('is-looping')

    const speed = 32 // px per second
    let position = list.scrollLeft
    let paused = 0
    let stopped = false
    let last = null

    function hold () { paused++ }
    function release () { paused = Math.max(0, paused - 1); position = list.scrollLeft }
    list.addEventListener('mouseenter', hold)
    list.addEventListener('mouseleave', release)
    list.addEventListener('touchstart', hold, { passive: true })
    list.addEventListener('touchend', function () { setTimeout(release, 1200) })
    list.addEventListener('focusin', hold)
    list.addEventListener('focusout', release)
    list.addEventListener('click', function (event) {
      if (event.target.closest('.community__start')) stopped = true
    })

    function step (time) {
      // Distance from a card to its clone, so the wrap is seamless (gap included).
      const half = list.children[originals.length].offsetLeft - originals[0].offsetLeft
      if (last !== null && !paused && !stopped && !document.hidden) {
        position += speed * Math.min(time - last, 100) / 1000
        if (position >= half) position -= half
        list.scrollLeft = position
      } else if (list.scrollLeft >= half) {
        // Swiped past the clones by hand: jump back to the matching original.
        list.scrollLeft -= half
        position = list.scrollLeft
      }
      last = time
      window.requestAnimationFrame(step)
    }
    window.requestAnimationFrame(step)
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
      stat.lastChild.textContent = format.format(Number(stat.getAttribute('data-community-count')))
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
    setupScenes()
    setupYoutubeEmbeds()
    setupTrailer()
    setupCommunity()
    setupScreenshotCarousels()
    setupGalleryLightbox()
    scrollToInitialHash()
  })
}())
