const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { Builder } = require('xml2js')

const rootDir = path.resolve(__dirname, '..')
const productDir = path.join(rootDir, 'squad-dunk')
const sourcePath = path.join(rootDir, 'content', 'squad-dunk.yml')
const outputPath = path.join(productDir, 'data.xml')

const allowedSectionIds = new Set([
  'factsheet',
  'description',
  'features',
  'media',
  'branding',
  'links',
  'team',
  'contact'
])

const generatedArchivePaths = new Set([
  'images/images.zip',
  'images/logo.zip'
])

const requiredLanguageCodes = ['en', 'es', 'ru', 'ja', 'zh', 'de', 'fr', 'pt']

function readContent () {
  try {
    const source = fs.readFileSync(sourcePath, 'utf8')
    return YAML.parse(source)
  } catch (error) {
    throw new Error(`Could not read ${relative(sourcePath)}. Check YAML syntax. ${error.message}`)
  }
}

function relative (filePath) {
  return path.relative(rootDir, filePath)
}

function fail (message) {
  throw new Error(`[content/squad-dunk.yml] ${message}`)
}

function asArray (value, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} must be a list`)
  return value
}

function optionalArray (value) {
  return Array.isArray(value) ? value : []
}

function requireString (value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${fieldName} must be a non-empty string`)
  }

  return value.trim()
}

function optionalString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function enabled (item) {
  return item && item.enabled !== false
}

function normalizePathForWeb (value, fieldName) {
  const valueString = requireString(value, fieldName).replace(/\\/g, '/')
  if (valueString.startsWith('/') || valueString.includes('..')) {
    fail(`${fieldName} must be a relative path without '..': ${valueString}`)
  }

  return valueString
}

function assertFileExists (webPath, fieldName, { allowGeneratedArchive = false } = {}) {
  if (allowGeneratedArchive && generatedArchivePaths.has(webPath)) return

  const diskPath = path.join(productDir, webPath)
  if (!fs.existsSync(diskPath)) {
    fail(`${fieldName} references a missing file: ${webPath}`)
  }
}

function assertUniqueIds (items, fieldName) {
  const seen = new Set()
  for (const item of items) {
    const id = requireString(item.id, `${fieldName}[].id`)
    if (seen.has(id)) fail(`${fieldName} contains duplicate id: ${id}`)
    seen.add(id)
  }
}

function normalizeSections (sections) {
  const rawSections = asArray(sections, 'sections').map((section) => {
    if (typeof section === 'string') return { id: section, enabled: true }
    if (!section || typeof section !== 'object') fail('sections entries must be strings or objects')
    return {
      id: requireString(section.id, 'sections[].id'),
      enabled: section.enabled !== false
    }
  })

  assertUniqueIds(rawSections, 'sections')

  for (const section of rawSections) {
    if (!allowedSectionIds.has(section.id)) {
      fail(`sections contains unknown id: ${section.id}`)
    }
  }

  return rawSections
}

function normalizeDownloads (content) {
  const downloads = optionalArray(content.downloads).map((download) => ({
    id: requireString(download.id, 'downloads[].id'),
    title: requireString(download.title, 'downloads[].title'),
    file: normalizePathForWeb(download.file, 'downloads[].file'),
    section: requireString(download.section, 'downloads[].section'),
    generated: download.generated === true,
    enabled: download.enabled !== false
  }))

  assertUniqueIds(downloads, 'downloads')

  for (const download of downloads.filter(enabled)) {
    assertFileExists(download.file, `downloads.${download.id}.file`, {
      allowGeneratedArchive: download.generated === true
    })
  }

  return downloads
}

function downloadForSection (downloads, section, fallbackTitle, fallbackFile) {
  const download = downloads.find((item) => item.section === section && enabled(item))
  return {
    title: download ? download.title : fallbackTitle,
    file: download ? download.file : fallbackFile
  }
}

function normalizeScreenshots (content) {
  const screenshotConfig = content.media && content.media.screenshots
  if (!screenshotConfig) fail('media.screenshots is required')

  const screenshots = asArray(screenshotConfig.items, 'media.screenshots.items').map((item) => ({
    id: requireString(item.id, 'media.screenshots.items[].id'),
    file: normalizePathForWeb(item.file, `media.screenshots.items.${item.id || '[missing-id]'}.file`),
    thumb: optionalString(item.thumb).replace(/\\/g, '/'),
    title: requireString(item.title, `media.screenshots.items.${item.id || '[missing-id]'}.title`),
    caption: optionalString(item.caption),
    alt: requireString(item.alt, `media.screenshots.items.${item.id || '[missing-id]'}.alt`),
    featured: item.featured === true,
    enabled: item.enabled !== false
  }))

  assertUniqueIds(screenshots, 'media.screenshots.items')

  for (const screenshot of screenshots.filter(enabled)) {
    assertFileExists(screenshot.file, `media.screenshots.items.${screenshot.id}.file`)
    if (screenshot.thumb && !screenshot.thumb.endsWith('.thumb.jpg')) {
      assertFileExists(screenshot.thumb, `media.screenshots.items.${screenshot.id}.thumb`)
    }
  }

  return screenshots
}

function normalizeVideos (content) {
  const videos = optionalArray(content.media && content.media.videos).map((video) => ({
    id: requireString(video.id, 'media.videos[].id'),
    title: requireString(video.title, 'media.videos[].title'),
    label: optionalString(video.label),
    description: optionalString(video.description),
    url: optionalString(video.url),
    status: optionalString(video.status),
    enabled: video.enabled !== false
  }))

  assertUniqueIds(videos, 'media.videos')
  return videos
}

function normalizeBrandingAssets (content) {
  const brandingConfig = content.branding || {}
  const assets = asArray(brandingConfig.assets, 'branding.assets').map((asset) => ({
    id: requireString(asset.id, 'branding.assets[].id'),
    type: requireString(asset.type, `branding.assets.${asset.id || '[missing-id]'}.type`),
    file: normalizePathForWeb(asset.file, `branding.assets.${asset.id || '[missing-id]'}.file`),
    title: requireString(asset.title, `branding.assets.${asset.id || '[missing-id]'}.title`),
    alt: requireString(asset.alt, `branding.assets.${asset.id || '[missing-id]'}.alt`),
    enabled: asset.enabled !== false
  }))

  assertUniqueIds(assets, 'branding.assets')

  for (const asset of assets.filter(enabled)) {
    assertFileExists(asset.file, `branding.assets.${asset.id}.file`)
  }

  return assets
}

function normalizeContacts (content) {
  const contacts = optionalArray(content.contacts).map((contact) => ({
    id: optionalString(contact.id),
    title: requireString(contact.title || contact.name, 'contacts[].title'),
    email: optionalString(contact.email || contact.mail),
    url: optionalString(contact.url || contact.link),
    enabled: contact.enabled !== false
  }))

  for (const contact of contacts.filter(enabled)) {
    if (!contact.email && !contact.url) fail(`contacts.${contact.title} needs email or url`)
  }

  return contacts
}

function normalizeLocalization (content) {
  const localization = content.localization || {}
  const defaultLanguage = requireString(localization.default, 'localization.default')
  const languages = asArray(localization.languages, 'localization.languages').map((language) => ({
    code: requireString(language.code, 'localization.languages[].code'),
    label: requireString(language.label, 'localization.languages[].label'),
    name: requireString(language.name, 'localization.languages[].name')
  }))

  assertUniqueIds(languages.map((language) => ({ id: language.code })), 'localization.languages')

  const languageCodes = new Set(languages.map((language) => language.code))
  for (const code of requiredLanguageCodes) {
    if (!languageCodes.has(code)) fail(`localization.languages must include ${code}`)
  }
  if (!languageCodes.has(defaultLanguage)) fail(`localization.default must be one of the configured languages: ${defaultLanguage}`)

  const translations = localization.translations || {}
  const english = translations.en && translations.en.description
  if (!english) fail('localization.translations.en.description is required')

  const short = english.short || {}
  const long = english.long || {}
  const keyFeatures = asArray(english.key_features, 'localization.translations.en.description.key_features').map((feature) => ({
    icon: optionalString(feature.icon) || '🏀',
    title: requireString(feature.title, 'localization.translations.en.description.key_features[].title'),
    body: requireString(feature.body, 'localization.translations.en.description.key_features[].body')
  }))

  const englishDescription = {
    heading: requireString(english.heading, 'localization.translations.en.description.heading'),
    short: {
      title: requireString(short.title, 'localization.translations.en.description.short.title'),
      text: requireString(short.text, 'localization.translations.en.description.short.text')
    },
    long: {
      title: requireString(long.title, 'localization.translations.en.description.long.title'),
      paragraphs: asArray(long.paragraphs, 'localization.translations.en.description.long.paragraphs').map((paragraph) => requireString(paragraph, 'localization.translations.en.description.long.paragraphs[]'))
    },
    keyFeaturesTitle: requireString(english.key_features_title, 'localization.translations.en.description.key_features_title'),
    keyFeatures
  }

  const normalizedTranslations = {}
  for (const language of languages) {
    normalizedTranslations[language.code] = translations[language.code] || {}
  }
  normalizedTranslations.en = {
    ...(normalizedTranslations.en || {}),
    description: englishDescription
  }

  return {
    defaultLanguage,
    languages,
    translations: normalizedTranslations,
    englishDescription
  }
}

function normalizeLinks (content) {
  const links = optionalArray(content.links).map((link) => ({
    id: requireString(link.id, 'links[].id'),
    title: requireString(link.title, 'links[].title'),
    url: optionalString(link.url),
    label: optionalString(link.label),
    enabled: link.enabled !== false
  }))

  assertUniqueIds(links, 'links')

  for (const link of links.filter(enabled)) {
    if (!link.url) fail(`links.${link.id}.url is required when enabled is true`)
  }

  return links
}

function createRenderSections (sections) {
  const enabledSections = sections.filter(enabled)
  const showFactsheet = enabledSections.some((section) => section.id === 'factsheet')
  const showDescription = enabledSections.some((section) => section.id === 'description')
  const showFeatures = !sections.some((section) => section.id === 'features') || enabledSections.some((section) => section.id === 'features')
  const showTeam = enabledSections.some((section) => section.id === 'team')
  const showContact = enabledSections.some((section) => section.id === 'contact')

  const output = []
  let overviewAdded = false
  let teamContactAdded = false

  for (const section of enabledSections) {
    if (['factsheet', 'description', 'features'].includes(section.id)) {
      if (!overviewAdded) {
        const overview = { id: 'overview' }
        if (showFactsheet) overview.showFactsheet = 'true'
        if (showDescription) overview.showDescription = 'true'
        if (showFeatures) overview.showFeatures = 'true'
        output.push(overview)
        overviewAdded = true
      }
      continue
    }

    if (['team', 'contact'].includes(section.id)) {
      if (!teamContactAdded) {
        const teamContact = { id: 'team-contact' }
        if (showTeam) teamContact.showTeam = 'true'
        if (showContact) teamContact.showContact = 'true'
        output.push(teamContact)
        teamContactAdded = true
      }
      continue
    }

    output.push({ id: section.id })
  }

  return output
}

function createNavSections (sections) {
  const titles = {
    factsheet: 'Factsheet',
    description: 'Description',
    features: 'Features',
    media: 'Media',
    branding: 'Branding',
    links: 'Links',
    team: 'Team',
    contact: 'Contact'
  }

  const hrefs = {
    factsheet: '#factsheet',
    description: '#description',
    features: '#features',
    media: '#media',
    branding: '#logo',
    links: '#links',
    team: '#credits',
    contact: '#contact'
  }

  return sections
    .filter(enabled)
    .filter((section) => titles[section.id] && hrefs[section.id])
    .map((section) => ({
      id: section.id,
      title: titles[section.id],
      href: hrefs[section.id]
    }))
}

function buildProductData (content) {
  const sections = normalizeSections(content.sections)
  const localization = normalizeLocalization(content)
  const downloads = normalizeDownloads(content)
  const screenshots = normalizeScreenshots(content)
  const videos = normalizeVideos(content)
  const brandingAssets = normalizeBrandingAssets(content)
  const contacts = normalizeContacts(content)
  const links = normalizeLinks(content)
  const mediaDownload = downloadForSection(downloads, 'media', content.media.screenshots.download_label || 'download all screenshots as .zip', content.media.screenshots.download_zip || 'images/images.zip')
  const brandingDownload = downloadForSection(downloads, 'branding', content.branding.download_label || 'download logo files as .zip', content.branding.download_zip || 'images/logo.zip')
  const team = content.team || {}
  const descriptionContent = localization.englishDescription

  const enabledScreenshots = screenshots.filter(enabled)
  const enabledBrandingAssets = brandingAssets.filter(enabled)
  const enabledVideos = videos.filter(enabled)
  const enabledContacts = contacts.filter(enabled)
  const enabledLinks = links.filter(enabled)

  if (enabledScreenshots.length === 0) fail('media.screenshots.items needs at least one enabled screenshot')
  if (enabledBrandingAssets.length === 0) fail('branding.assets needs at least one enabled asset')

  return {
    product: {
      title: requireString(content.title, 'title'),
      website: requireString(content.website, 'website'),
      'release-dates': {
        'release-date': asArray(content.release_dates, 'release_dates').map((date) => requireString(date, 'release_dates[]'))
      },
      genres: {
        genre: asArray(content.genres, 'genres').map((genre) => requireString(genre, 'genres[]'))
      },
      platforms: {
        platform: asArray(content.platforms, 'platforms').map((platform) => ({
          name: requireString(platform.name, 'platforms[].name'),
          ...(platform.link ? { link: requireString(platform.link, 'platforms[].link') } : {})
        }))
      },
      description: descriptionContent.short.text,
      history: descriptionContent.long.paragraphs.join(' '),
      features: {
        feature: descriptionContent.keyFeatures.map((feature) => `${feature.title}: ${feature.body}`)
      },
      'description-heading': descriptionContent.heading,
      'short-description-title': descriptionContent.short.title,
      'short-description': descriptionContent.short.text,
      'long-description-title': descriptionContent.long.title,
      'long-descriptions': {
        'long-description': descriptionContent.long.paragraphs
      },
      'key-features-title': descriptionContent.keyFeaturesTitle,
      'key-features': {
        'key-feature': descriptionContent.keyFeatures
      },
      'default-language': localization.defaultLanguage,
      languages: {
        language: localization.languages
      },
      'localization-json': JSON.stringify({
        defaultLanguage: localization.defaultLanguage,
        languages: localization.languages,
        translations: localization.translations
      }),
      sections: {
        section: createRenderSections(sections)
      },
      'nav-sections': {
        'nav-section': createNavSections(sections)
      },
      'media-videos': {
        'media-video': enabledVideos
      },
      'manifest-screenshots': {
        'manifest-screenshot': enabledScreenshots.map((screenshot) => ({
          id: screenshot.id,
          file: screenshot.file,
          thumb: screenshot.thumb || `${screenshot.file}.thumb.jpg`,
          title: screenshot.title,
          caption: screenshot.caption,
          alt: screenshot.alt,
          featured: screenshot.featured ? 'true' : ''
        }))
      },
      'branding-assets': {
        'branding-asset': enabledBrandingAssets
      },
      downloads: {
        download: downloads.filter(enabled)
      },
      'media-download-title': mediaDownload.title,
      'media-download-file': mediaDownload.file,
      'branding-download-title': brandingDownload.title,
      'branding-download-file': brandingDownload.file,
      'show-team-section': createRenderSections(sections).some((section) => section.id === 'team-contact' && section.showTeam) ? 'true' : '',
      'show-contact-section': createRenderSections(sections).some((section) => section.id === 'team-contact' && section.showContact) ? 'true' : '',
      team: {
        'about-title': requireString(team.about_title, 'team.about_title'),
        'boilerplate-title': requireString(team.boilerplate_title, 'team.boilerplate_title'),
        boilerplate: requireString(team.boilerplate, 'team.boilerplate'),
        'credits-title': requireString(team.credits_title, 'team.credits_title'),
        credits: requireString(team.credits, 'team.credits')
      },
      contacts: {
        contact: enabledContacts.map((contact) => ({
          name: contact.title,
          ...(contact.email ? { mail: contact.email } : {}),
          ...(contact.url ? { link: contact.url } : {})
        }))
      },
      links: {
        link: enabledLinks
      }
    }
  }
}

function writeXml (data) {
  const builder = new Builder({
    xmldec: { version: '1.0', encoding: 'utf-8' },
    renderOpts: { pretty: true, indent: '  ', newline: '\n' }
  })
  const xml = builder.buildObject(data) + '\n'
  fs.writeFileSync(outputPath, xml, 'utf8')
}

try {
  const content = readContent()
  writeXml(buildProductData(content))
  console.log(`Generated ${relative(outputPath)} from ${relative(sourcePath)}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
