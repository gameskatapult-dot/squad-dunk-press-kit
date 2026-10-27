'use strict'

const fs = require('fs')
const path = require('upath')
const chalk = require('chalk')
const sharp = require('sharp')

const packageVersion = require('../../package.json').version

const console = require('../helpers/color-console')
const sfs = require('../helpers/sfs')
const zip = require('../helpers/zip')
const archiver = require('archiver')

const { createTemplate } = require('./template')

const config = require('../config')
const { imagesFolderName, authorizedImageFormats } = require('../assets')

// -------------------------------------------------------------
// Module.
// -------------------------------------------------------------

async function build (dataFilePath, presskit, {
  company = {},
  products = [],
  analytics = ''
} = {}) {
  const buildFolder = createAndGetBuildFolder()
  if (presskit.type === 'product' && presskit.localizationJson) {
    fs.writeFileSync(path.join(buildFolder, 'localization.json'), presskit.localizationJson, 'utf8')
  }
  const pageFolder = getPageFolder(buildFolder, dataFilePath, presskit)

  // Create the page folder.
  sfs.createDir(pageFolder)

  const htmlFilePath = getHtmlFilePath(pageFolder)
  console.log(`- "${presskit.title}" -> ${chalk.blue(htmlFilePath)}`)

  // Templates and images.
  const template = createTemplate(presskit.type, pageFolder)
  const assetsSource = getImagesFolder(dataFilePath)
  const images = getImages(assetsSource)

  // Copy images and zips to the page folder.
  const assetsTarget = path.join(pageFolder, imagesFolderName)
  sfs.copyDirContent(assetsSource, assetsTarget)

  // Add thumbnails on the screenshot images.
  // Because the thumbnails are not in the `images` object, they won't
  // be added to the zips. Neat.
  if (!config.commands.build.ignoreThumbnails) {
    await createThumbnails(assetsTarget, images.screenshots)
  }

  // This must be done after `sfs.copyDirContent`.
  // Otherwise, we might override existing archives.
  // Manifest downloads must contain only the assets currently offered on the page.
  // Older source files remain available for future edits, outside these archives.
  const archiveImages = {
    ...images,
    ...(presskit.brandingAssets ? { logos: presskit.brandingAssets.map((asset) => asset.file.replace(/^images\//, '')) } : {}),
    ...(presskit.manifestScreenshots ? { screenshots: presskit.manifestScreenshots.map((asset) => asset.file.replace(/^images\//, '')) } : {})
  }
  exportArchives(archiveImages, assetsSource, assetsTarget)
  createPressKitArchive(presskit, company, assetsSource, assetsTarget)

  // Apply data to template.
  const html = template({
    presskit,
    company,
    products,
    images: sortScreenshotsByCategories(images),
    assets: (presskit.type === 'company' || presskit.topLevel ? '.' : '..'),
    analytics,

    // Handlebars can't check for equality, so we provide two
    // variables to differentiate a product and a company sheet.
    isCompany: presskit.type === 'company',
    isProduct: presskit.type === 'product',

    // Same to know if a presskit has any screenshots.
    hasScreenshots: images.screenshots && images.screenshots.length > 0,

    // Additional build options:
    hamburger: config.commands.build.hamburger,

    // Misc.
    buildVersion: packageVersion,
    buildTime: new Date().getTime()
  })

  // Export the HTML to a file.
  fs.writeFileSync(htmlFilePath, html)

  // And return the relative path from `build/`.
  return path.relative(buildFolder, htmlFilePath)
}

// -------------------------------------------------------------
// Folders.
// -------------------------------------------------------------

function createAndGetBuildFolder () {
  const destination = config.commands.build.output
  sfs.createDir(destination)

  return destination
}

function getHtmlFilePath (pageFolder) {
  return path.join(pageFolder, 'index.html')
}

function getPageFolder (buildFolder, dataFilePath, presskit) {
  // Logic:
  // - Company page should be placed in the root folder.
  // - Top-level products (standalone game presskits) go to the root folder too.
  // - But each other product page is a subfolder.

  if (presskit.type === 'company' || presskit.topLevel) {
    return buildFolder
  }

  const productFolderName = path.basename(path.dirname(dataFilePath))
  return path.join(buildFolder, productFolderName)
}

// Get an absolute page url from its location in the build process.
function getAbsolutePageUrl (dataFilePath, presskit) {
  const buildFolder = createAndGetBuildFolder()
  const pageFolder = getPageFolder(buildFolder, dataFilePath, presskit)

  const htmlFilePath = getHtmlFilePath(pageFolder)
  const relativePath = path.posix.relative(buildFolder, htmlFilePath)

  return path.posix.join(config.commands.build.baseUrl, relativePath)
}

// -------------------------------------------------------------
// Images.
// -------------------------------------------------------------

// Get the folder containing the images.
function getImagesFolder (dataFile) {
  const stat = fs.statSync(dataFile)
  const dataFileFolder = stat.isFile() ? path.dirname(dataFile) : dataFile

  return path.join(dataFileFolder, imagesFolderName)
}

// Get the images in the source, and sort them by types.
// We are interested in three types of images:
// - the header, starting with 'header'.
// - the logos, starting with 'logo'.
// - And the rest (what we call "screenshots").
function getImages (source) {
  if (!fs.existsSync(source)) {
    console.error(`No images found for "${source}"`, '🤔')
    return { header: null, screenshots: [], logos: [] }
  }

  const images = { header: null, screenshots: [], logos: [] }

  sfs.findAllFiles(source)
    .forEach(filePathWithSource => {
      // Remove 'path/to/images' from 'path/to/images/filename'.
      // ie, 'data/product/images/burger01.png' becomes 'burger01.png'.
      // This is super important. We only need this portion for:
      // - the comparison below
      // - the url on the site
      // - the copy to the built presskit
      const f = path.relative(source, filePathWithSource)

      // Authorize only these formats.
      const ext = path.extname(f)
      if (!authorizedImageFormats.includes(ext)) return

      // Ignore favicon.
      if (f.toLowerCase() === 'favicon.ico') return

      // And put in the correct category.
      if (f.toLowerCase().startsWith('header')) {
        images.header = f
      } else if (f.toLowerCase().startsWith('logo')) {
        images.logos.push(f)
      } else {
        images.screenshots.push(f)
      }
    })

  return images
}

// This function takes a list of images and separate the images which are
// in a folder into separate categories.
//
// **Pure function.**
//
//   Example:
//     - burger01.png
//     - gifs/burger02.png
//     - wallpapers/burger03.png
//     - wallpapers/burger04.png
//   → {
//     ...
//     screenshots: ['burger01.png']
//     screenshotsWithCategory: {
//       gifs: {title: 'gifs', elements: ['gifs/burger02.png']}
//       wallpapers: {title: 'gifs', elements: ['wallpapers/burger03.png', 'wallpapers/burger04.png']}
//     }
//     ...
//   }
function sortScreenshotsByCategories (images) {
  const clone = { ...images }

  // Abort early if no screenshots.
  const screenshots = clone.screenshots
  if (!screenshots) return clone

  // We put category-less screenshots first. This is important.
  const result = []
  const withCategories = {}

  for (const i of screenshots) {
    // We get the category from the dirname.
    const category = path.dirname(i)

    // Separate the screenshots which are at the root of the images folder.
    // They must be first, so we store them in another array.
    if (category === '.') {
      result.push(i)
    } else {
      // Create a new category first.
      if (!withCategories[category]) {
        withCategories[category] = {}
        withCategories[category].title = category
        withCategories[category].elements = []
      }

      withCategories[category].elements.push(i)
    }
  }

  clone.screenshots = result
  clone.screenshotsWithCategory = withCategories
  return clone
}

// Create thumbnails.
// For each provided images, generate a low-res jpg thumbnail.
// Even for gif.
//
// We don't check if the format of the images is valid,
// since the check is already done when constructing the images object.
async function createThumbnails (target, images) {
  for (const x of images) {
    const imagePath = path.join(target, x)
    const thumbPath = path.join(target, `${x}.thumb.jpg`)

    try {
      // Background and flatten are for transparent PNGs/Gifs.
      // We force a white background here.

      await sharp(imagePath)
        .resize(450)
        .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .jpeg()
        .toFile(thumbPath)
    } catch (e) {
      const msg = chalk.dim(`(${e.message})`)
      console.warn(`The '${chalk.bold(x)}' thumbnail has not been generated. ${msg}`)
    }
  }
}

// -------------------------------------------------------------
// Archives.
// -------------------------------------------------------------

// Export archives for screenshots and logos.
function exportArchives (images, source, target) {
  if (!images) return

  createArchive('images.zip', target, source, images.screenshots)
  createArchive('logo.zip', target, source, images.logos)
}

function createArchive (name, target, source, files) {
  if (!files) return

  // Do not override an existing archive.
  if (fs.existsSync(path.join(source, name))) {
    console.warn(`An existing archive named ${chalk.blue(name)} has been found in the assets. Keeping it…`)
    return
  }

  zip(name, target, source, files)
}

// One download with everything the page offers, sorted into folders,
// plus a plain-text fact sheet. Built on every deploy, so it never goes stale.
function createPressKitArchive (presskit, company, source, target) {
  const name = 'DUNK-press-kit.zip'
  const root = 'DUNK press kit'
  const toArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value])
  const groups = [
    ['Screenshots', toArray(presskit.manifestScreenshots).map((asset) => asset.file)],
    ['Key art and logos', toArray(presskit.brandingAssets).map((asset) => asset.file)],
    ['Announcement', toArray(presskit.announcementItems).map((item) => item.file)],
    ['Gameplay videos', toArray(presskit.featureVideos).map((video) => video.file)]
  ]

  const output = fs.createWriteStream(path.join(target, name))
  const archive = archiver('zip', { store: true })
  archive.on('error', (err) => { throw err })
  archive.pipe(output)

  archive.append(pressKitFactSheet(presskit, company, toArray), { name: `${root}/Fact sheet.txt` })
  for (const [folder, files] of groups) {
    for (const file of files) {
      const relative = file.replace(/^images\//, '')
      archive.append(fs.createReadStream(path.join(source, relative)), { name: `${root}/${folder}/${path.basename(relative)}` })
    }
  }

  archive.finalize()
}

function pressKitFactSheet (presskit, company, toArray) {
  const lines = [presskit.title, '']
  const fact = (label, value) => { if (value) lines.push(`${label}: ${value}`) }

  fact('Developer and publisher', presskit.publisher)
  fact('Based in', company && company.basedIn)
  fact('Development', presskit.development)
  fact('Release date', toArray(presskit.releaseDates).join(', '))
  fact('Platforms', toArray(presskit.platforms).map((platform) => platform.name || platform).join(', '))
  fact('Genres', toArray(presskit.genres).join(', '))
  fact('Steam', presskit.steamLink && presskit.steamLink.url)
  fact('Website', presskit.website)
  fact('Press contact', presskit.pressEmail)

  lines.push('', 'About the game', '')
  toArray(presskit.longDescriptions).forEach((paragraph) => lines.push(paragraph, ''))
  toArray(presskit.keyFeatures).forEach((feature) => lines.push(feature.title, '', feature.body, ''))

  const features = toArray(presskit.features)
  if (features.length) {
    lines.push('Features', '')
    features.forEach((feature) => lines.push(`- ${feature}`))
    lines.push('')
  }

  // The BOM keeps curly quotes and dashes readable in Windows Notepad.
  return '﻿' + lines.join('\r\n')
}

// -------------------------------------------------------------
// Exports.
// -------------------------------------------------------------

module.exports = {
  build,
  getAbsolutePageUrl,
  createAndGetBuildFolder
}
