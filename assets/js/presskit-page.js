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

  document.addEventListener('DOMContentLoaded', async function () {
    setupAnalyticsEvents()
    await setupLanguageSelector()
    setupNavigation()
    setupLandingHero()
    setupYoutubeEmbeds()
    setupScreenshotCarousels()
    setupGalleryLightbox()
  })
}())
