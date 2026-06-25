(function () {
  'use strict'

  const storageKey = 'squad-dunk-presskit-language'

  function getPathValue (source, path) {
    return path.split('.').reduce(function (value, segment) {
      if (value == null) return undefined
      return value[segment]
    }, source)
  }

  function readLocalization () {
    const script = document.getElementById('presskit-localization')
    if (!script) return null

    try {
      return JSON.parse(script.textContent)
    } catch (error) {
      return null
    }
  }

  function setupLanguageSelector () {
    const data = readLocalization()
    const select = document.querySelector('[data-language-select]')
    if (!data || !select || !Array.isArray(data.languages)) return

    const supported = data.languages.map(function (language) { return language.code })
    const defaultLanguage = data.defaultLanguage || 'en'
    const params = new URLSearchParams(window.location.search)
    const urlLanguage = params.get('lang')
    const storedLanguage = window.localStorage ? window.localStorage.getItem(storageKey) : null

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
      const storedMatch = matchSupportedLanguage(storedLanguage)
      if (storedMatch) return storedMatch

      const urlMatch = matchSupportedLanguage(urlLanguage)
      if (urlMatch) return urlMatch

      return detectBrowserLanguage()
    }

    function applyLanguage (language, options) {
      const settings = options || {}
      const selectedLanguage = matchSupportedLanguage(language) || fallbackLanguage()
      const activeLanguage = data.translations && data.translations[selectedLanguage] && Object.keys(data.translations[selectedLanguage]).length
        ? selectedLanguage
        : fallbackLanguage()
      const activeTranslation = data.translations ? data.translations[activeLanguage] : null

      select.value = selectedLanguage
      document.documentElement.setAttribute('lang', activeLanguage)

      if (settings.persist && window.localStorage) window.localStorage.setItem(storageKey, selectedLanguage)

      if (activeTranslation) {
        const nodes = document.querySelectorAll('[data-l10n]')
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const value = getPathValue(activeTranslation, node.getAttribute('data-l10n'))
          if (typeof value === 'string') node.textContent = value
        }
      }

      if (settings.updateUrl && window.history && window.history.replaceState) {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('lang', selectedLanguage)
        window.history.replaceState({}, '', nextUrl.toString())
      }
    }

    select.addEventListener('change', function () {
      applyLanguage(select.value, { updateUrl: true, persist: true })
    })

    applyLanguage(initialLanguage(), { updateUrl: Boolean(urlLanguage && !matchSupportedLanguage(storedLanguage)), persist: false })
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

  function setupGalleryLightbox () {
    const links = Array.prototype.slice.call(document.querySelectorAll('[data-gallery="screenshots"]'))
    if (!links.length) return

    const items = links.map(function (link) {
      const image = link.querySelector('img')
      return {
        href: link.getAttribute('href'),
        title: link.getAttribute('data-gallery-title') || link.getAttribute('title') || '',
        alt: image ? image.getAttribute('alt') || '' : ''
      }
    }).filter(function (item) {
      return item.href
    })

    if (!items.length) return

    let currentIndex = 0
    const lightbox = document.createElement('div')
    lightbox.className = 'gallery-lightbox'
    lightbox.setAttribute('role', 'dialog')
    lightbox.setAttribute('aria-modal', 'true')
    lightbox.setAttribute('aria-label', 'Screenshot viewer')
    lightbox.innerHTML = [
      '<div class="gallery-lightbox__dialog">',
      '  <figure class="gallery-lightbox__figure">',
      '    <img class="gallery-lightbox__image" alt="">',
      '  </figure>',
      '  <div class="gallery-lightbox__caption">',
      '    <span class="gallery-lightbox__title"></span>',
      '    <span class="gallery-lightbox__count"></span>',
      '  </div>',
      '  <button class="gallery-lightbox__button gallery-lightbox__close" type="button" aria-label="Close screenshot viewer">×</button>',
      '  <button class="gallery-lightbox__button gallery-lightbox__prev" type="button" aria-label="Previous screenshot">‹</button>',
      '  <button class="gallery-lightbox__button gallery-lightbox__next" type="button" aria-label="Next screenshot">›</button>',
      '</div>'
    ].join('')

    document.body.appendChild(lightbox)

    const image = lightbox.querySelector('.gallery-lightbox__image')
    const title = lightbox.querySelector('.gallery-lightbox__title')
    const count = lightbox.querySelector('.gallery-lightbox__count')
    const closeButton = lightbox.querySelector('.gallery-lightbox__close')
    const prevButton = lightbox.querySelector('.gallery-lightbox__prev')
    const nextButton = lightbox.querySelector('.gallery-lightbox__next')

    function render () {
      const item = items[currentIndex]
      image.setAttribute('src', item.href)
      image.setAttribute('alt', item.alt || item.title)
      title.textContent = item.title
      count.textContent = (currentIndex + 1) + ' / ' + items.length
    }

    function open (index) {
      currentIndex = index
      render()
      lightbox.classList.add('is-open')
      document.body.classList.add('gallery-lightbox-open')
      closeButton.focus()
    }

    function close () {
      lightbox.classList.remove('is-open')
      document.body.classList.remove('gallery-lightbox-open')
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

    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) close()
    })

    document.addEventListener('keydown', function (event) {
      if (!lightbox.classList.contains('is-open')) return

      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupLanguageSelector()
    setupNavigation()
    setupLandingHero()
    setupYoutubeEmbeds()
    setupGalleryLightbox()
  })
}())
