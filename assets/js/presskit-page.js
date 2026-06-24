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

    function applyLanguage (language, updateUrl) {
      const selectedLanguage = isSupported(language) ? language : defaultLanguage
      const activeLanguage = data.translations && data.translations[selectedLanguage] && Object.keys(data.translations[selectedLanguage]).length
        ? selectedLanguage
        : defaultLanguage
      const activeTranslation = data.translations ? data.translations[activeLanguage] : null

      select.value = selectedLanguage
      document.documentElement.setAttribute('lang', activeLanguage)

      if (window.localStorage) window.localStorage.setItem(storageKey, selectedLanguage)

      if (activeTranslation) {
        const nodes = document.querySelectorAll('[data-l10n]')
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const value = getPathValue(activeTranslation, node.getAttribute('data-l10n'))
          if (typeof value === 'string') node.textContent = value
        }
      }

      if (updateUrl && window.history && window.history.replaceState) {
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('lang', selectedLanguage)
        window.history.replaceState({}, '', nextUrl.toString())
      }
    }

    select.addEventListener('change', function () {
      applyLanguage(select.value, true)
    })

    applyLanguage(isSupported(urlLanguage) ? urlLanguage : storedLanguage, Boolean(urlLanguage))
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

  document.addEventListener('DOMContentLoaded', function () {
    setupLanguageSelector()
    setupNavigation()
    setupLandingHero()
    setupYoutubeEmbeds()
  })
}())
