/**
 * @fileOverview
 * @name codius-state.js
 * @author Travis Crist
 */

const logger = require('riverpig')('codius-cli:codius-state')
const fse = require('fs-extra')
const BigNumber = require('bignumber.js')
const { hashManifest } = require('codius-manifest')
const config = require('../config.js')
const examples = require('../common/examples.js')
const nodeDir = require('node-dir')
const inquirer = require('inquirer')
const path = require('path')

async function validateOptions (
  status,
  { hosts,
    codiusFile,
    codiusVarsFile,
    codiusHostsFile,
    codiusStateFile,
    overwriteCodiusState,
    assumeYes }) {
  const currDir = process.cwd()
  const codiusStateExists = await fse.pathExists(codiusStateFile)
  logger.debug(`overwrite codius state: ${overwriteCodiusState}`)
  if (codiusStateExists && !overwriteCodiusState) {
    const errorMessage = `Codius State File\n ${currDir}/${codiusStateFile}\nalready exists. Please remove "${codiusStateFile} from the current working directory or pass option --overwrite-codius-state`
    throw new Error(errorMessage)
  }

  let codiusExists = await fse.pathExists(codiusFile)
  let codiusVarsExists = await fse.pathExists(codiusVarsFile)
  const codiusHostsExists = await fse.pathExists(codiusHostsFile)
  if (codiusFile === 'codius.json' && codiusVarsFile === 'codiusvars.json' &&
      !codiusExists && !codiusVarsExists) {
    let userResp = {}
    if (assumeYes) {
      logger.debug(`No codius.json and codiusvars.json file present in ${currDir}, creating examples since --assume-yes flag is present`)
      userResp.createExample = true
    } else {
      status.warn(`No codius.json and codiusvars.json files present in ${currDir}`)
      userResp = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'createExample',
          message: `Would you like example codius.json and codiusvars.json to be generated in ${currDir}?`,
          default: false
        }
      ])
    }
    if (userResp.createExample) {
      await examples.createExample('nginx')
      codiusExists = await fse.pathExists(codiusFile)
      codiusVarsExists = await fse.pathExists(codiusVarsFile)
      status.succeed(`Created codius.json and codiusvars.json file in ${currDir}`)
    }
  } else if (codiusVarsFile === 'codiusvars.json' && !codiusVarsExists) {
    let userResp = {}
    if (assumeYes) {
      logger.debug(`No codiusvars.json file present in ${currDir}, creating example since --assume-yes flag is present`)
      userResp.createExample = true
    } else {
      status.warn(`No codiusvars.json file present in ${currDir}`)
      userResp = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'createExample',
          message: `Would you like example codiusvars.json to be generated in ${currDir}?`,
          default: false
        }
      ])
    }
    if (userResp.createExample) {
      await examples.createExample('codiusvars')
      codiusExists = await fse.pathExists(codiusFile)
      codiusVarsExists = await fse.pathExists(codiusVarsFile)
      status.succeed(`Created codiusvars.json file in ${currDir}`)
    }
  }

  status.start('Validating File Locations')

  if (!codiusExists) {
    let errorMessage
    if (codiusFile === 'codius.json') {
      errorMessage = `Codius File\n ${currDir}/${codiusFile}\ndoes not exists please add a codius.json file.`
    } else {
      errorMessage = `Codius File\n ${codiusFile}\ndoes not exist, please add a codius.json file.`
    }
    throw new Error(errorMessage)
  }

  if (!codiusVarsExists) {
    let errorMessage
    if (codiusVarsFile === 'codiusvars.json') {
      errorMessage = `Codius Vars File\n ${currDir}/${codiusVarsFile}\ndoes not exists please add a codiusvars.json file.`
    } else {
      errorMessage = `Codius Vars File\n ${codiusFile}\ndoes not exist, please add a codiusvars.json file.`
    }
    throw new Error(errorMessage)
  }

  if (!hosts && codiusHostsFile !== 'codiushosts.json' && !codiusHostsExists) {
    let errorMessage
    if (codiusHostsFile === 'codiushosts.json') {
      errorMessage = `Codius Hosts File\n ${currDir}/${codiusHostsFile}\n does not exists please check the location of your ${codiusHostsFile}.`
    } else {
      errorMessage = `Codius Hosts File\n ${codiusHostsFile}\ndoes not exist, please check the location of your ${codiusHostsFile}.`
    }
    throw new Error(errorMessage)
  }
  status.succeed()
}

function getHostList (codiusStateJson, uploadResponses) {
  const successfulHostList = [...new Set(uploadResponses.success.map(obj => obj.host))]
  const existingHostList = codiusStateJson ? codiusStateJson.hostList : []
  const fullHostList = [...new Set([...successfulHostList, ...existingHostList])]
  logger.debug(fullHostList)
  return fullHostList
}

async function saveCodiusState (
  { codiusStateFile,
    maxMonthlyRate = config.price.amount,
    units = config.price.units,
    duration },
  manifestJson,
  uploadResponses,
  codiusStateJson) {
  let hostDetailsObj = (codiusStateJson && codiusStateJson.status &&
    codiusStateJson.status.hostDetails) ? codiusStateJson.status.hostDetails : {}

  let cronJobsObj = (codiusStateJson && codiusStateJson.status &&
    codiusStateJson.status.cronJobs) ? codiusStateJson.status.cronJobs : []

  uploadResponses.success.forEach(obj => {
    let existingTotal = new BigNumber(0)
    if (hostDetailsObj && hostDetailsObj[obj.host]) {
      existingTotal = new BigNumber(hostDetailsObj[obj.host] ? hostDetailsObj[obj.host].price.totalPaid : 0)
    }
    const updatedTotalPaid = existingTotal.plus(obj.pricePaid)
    hostDetailsObj[obj.host] = {
      url: obj.url,
      expirationDate: obj.expirationDate,
      price: {
        totalPaid: updatedTotalPaid,
        lastPaid: obj.pricePaid,
        units: obj.units
      }
    }
  })

  const codiusStateObj = {
    description: 'Codius State File which is generated from the provided codius.json, codiusvars.json, and codiushosts.json files.',
    manifestHash: hashManifest(manifestJson.manifest),
    generatedManifest: manifestJson,
    options: {
      maxMonthlyRate: maxMonthlyRate,
      units: units,
      duration: duration
    },
    hostList: getHostList(codiusStateJson, uploadResponses),
    status: {
      hostDetails: hostDetailsObj,
      cronJobs: cronJobsObj
    }
  }
  logger.debug(`Codius State File Obj:\n${JSON.stringify(codiusStateObj, null, 2)}`)
  await fse.writeJson(codiusStateFile, codiusStateObj, { spaces: 2 })
}

async function getCodiusStateFilePath () {
  const files = await new Promise((resolve, reject) => {
    nodeDir.readFiles(process.cwd(), {
      match: /\.codiusstate\.json$/, recursive: false
    }, (err, content, next) => {
      if (err) throw err
      next()
    }, (err, files) => {
      if (err) reject(err)
      resolve(files)
    })
  })

  let codiusStateFilePath
  if (files.length === 1) {
    codiusStateFilePath = files[0]
    logger.debug(`Found ${codiusStateFilePath} file`)
  } else if (files.length > 1) {
    throw new Error(`Found multiple *.codiusstate.json files:\n${JSON.stringify(files)}\nonly one *.codiusstate.json file is supported.`)
  } else {
    throw new Error(`Unable to find any *codiusstate.json files, please check that one exists in your current working directory ${process.cwd()}. Run 'codius upload <commands>' to create a *.codiusstate.json file.`)
  }

  return codiusStateFilePath
}

async function getCodiusState (status, options) {
  let codiusStateFilePath
  if (options.codiusStateFile !== 'default.codiusstate.json') {
    status.start(`Checking ${options.codiusStateFile} exists`)
    const codiusStateExists = await fse.pathExists(options.codiusStateFile)
    if (!codiusStateExists) {
      throw new Error(`Codius State File at ${options.codiusStateFile} does not exist, please check the provided file location`)
    }
    codiusStateFilePath = path.resolve(options.codiusStateFile)
  } else {
    status.start(`Checking for *.codiusstate.json file in current dir ${process.cwd()}`)
    codiusStateFilePath = await getCodiusStateFilePath()
  }
  const codiusStateJson = await fse.readJson(codiusStateFilePath)
  status.succeed()
  return { codiusStateFilePath, codiusStateJson }
}

module.exports = {
  validateOptions,
  saveCodiusState,
  getCodiusState
}
