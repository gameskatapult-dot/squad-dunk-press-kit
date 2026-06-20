const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { Builder } = require('xml2js')

const rootDir = path.resolve(__dirname, '..')
const sourcePath = path.join(rootDir, 'content', 'squad-dunk.yml')
const outputPath = path.join(rootDir, 'squad-dunk', 'data.xml')

function readContent () {
  const source = fs.readFileSync(sourcePath, 'utf8')
  return YAML.parse(source)
}

function asArray (value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a list in ${sourcePath}`)
  }

  return value
}

function requireString (value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string in ${sourcePath}`)
  }

  return value.trim()
}

function optionalContact (contact) {
  const output = {
    name: requireString(contact.name, 'contacts[].name')
  }

  if (contact.mail) output.mail = requireString(contact.mail, 'contacts[].mail')
  if (contact.link) output.link = requireString(contact.link, 'contacts[].link')

  if (!output.mail && !output.link) {
    throw new Error('Each contact needs either mail or link')
  }

  return output
}

function buildProductData (content) {
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
      description: requireString(content.description, 'description'),
      history: requireString(content.history, 'history'),
      features: {
        feature: asArray(content.features, 'features').map((feature) => requireString(feature, 'features[]'))
      },
      contacts: {
        contact: asArray(content.contacts, 'contacts').map(optionalContact)
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

const content = readContent()
writeXml(buildProductData(content))
console.log(`Generated ${path.relative(rootDir, outputPath)} from ${path.relative(rootDir, sourcePath)}`)
