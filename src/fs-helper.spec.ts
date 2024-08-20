import * as rimraf from 'rimraf'
import { writeFileSync, mkdirSync } from 'fs'
import { readRecursively } from './fs-helper'

describe('fs-helper', () => {
  describe('readRecursively', () => {
    const directory = `/tmp/${Date.now()}`

    beforeEach(() => {
      mkdirSync(directory)
    })
    afterEach(() => {
      rimraf.sync(directory)
    })

    it('should return a list of files in a folder', () => {
      mkdirSync(`${directory}/static`)
      mkdirSync(`${directory}/images`)
      mkdirSync(`${directory}/images/icons`)
      writeFileSync(`${directory}/index.html`, '')
      writeFileSync(`${directory}/static/main.aaaaaa.js`, '')
      writeFileSync(`${directory}/static/1.bbbbbb.js`, '')
      writeFileSync(`${directory}/static/1.bbbbbb.css`, '')
      writeFileSync(`${directory}/images/icons/logo.png`, '')

      expect(readRecursively(directory)).toEqual(
        [
          'images/icons/logo.png',
          'index.html',
          'static/1.bbbbbb.css',
          'static/1.bbbbbb.js',
          'static/main.aaaaaa.js',
        ].map(path => `${directory}/${path}`)
      )
    })
  })
})
