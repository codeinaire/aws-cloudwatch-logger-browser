/**
 * Copyright (c) 2017, Neap Pty Ltd.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
*/

const axios = require('axios');

const createLogStream = (logStreamName,  { uri, logGroupName, local }) => {
	if (local && local != 'false')
		return Promise.resolve({ message: 'No need to create stream. Local mode is on.' })

	if (!logGroupName)
		throw new Error('Missing required argument: \'logGroupName\' is required.')
	if (!logStreamName)
    throw new Error('Missing required argument: \'logStreamName\' is required.')
  if (!uri)
    throw new Error('Missing required argument: \'uri\' is required.')

	const payload = {
		logGroupName: logGroupName,
		logStreamName: logStreamName
  }

  const headers = {
    headers: {
      'Content-Type': 'application/json'
    }
  }

	const request = axios.create({
		baseURL: uri,
		headers: headers
	})

	return request.post('', payload)
		.then(results => results.data)
		.catch(err => {
			throw new Error(err.response.data.message)
		})
}

const _sequenceTokens = new Map()
/**
 * Adds logs to a AWS CloudWatch log stream
 * @param  {String|Object|Array} 	entry         	If type is Object it must be structured as follow: { message: ..., timestamp: ... }
 *                                               	where 'message' must be a string and 'timestamp' must be an UTC date number
 *                                               	(e.g. Date.now())
 *                                               	If type is Array, then each item must either be a string or an object { message: ..., timestamp: ... }
 *                                               	following the same rules as above.
 * @param  {String} 				logGroupName  	[description]
 * @param  {String} 				logStreamName 	[description]
 * @param  {String} 				sequenceToken 	[description]
 * @param  {Number} 				retryCount    	[description]
 * @return {Promise}               					[description]
 */
const addLogsToStream = (entry, logGroupName, logStreamName, uri, sequenceToken='', retryCount=0) => {
	if (!logGroupName)
		throw new Error('Missing required argument: \'logGroupName\' is required.')
	if (!logStreamName)
		throw new Error('Missing required argument: \'logStreamName\' is required.')
	if (!entry)
    throw new Error('Missing required argument: \'entry\' is required.')
  if (!uri)
    throw new Error('Missing required argument: \'uri\' is required.')

	const entryType = typeof(entry)
  const now = Date.now()

	const events =
		// entry is a message
		entryType == 'string' ? [{ message: entry, timestamp: now }] :
		// entry is a well-formatted log event
			entryType == 'object' && entry.timestamp ? [{ message: entry.message, timestamp: entry.timestamp }] :
				// entry is an array of items
				entry.length > 0 ? entry.map(e =>
					typeof(e) == 'string' ? { message: e, timestamp: now } :
						e.timestamp ? { message: e.message, timestamp: e.timestamp } : null).filter(x => x)
					: null

	const nothingToLog = events == null

	let payload = {
    sequenceToken,
		logEvents: events,
		logGroupName: logGroupName,
		logStreamName: logStreamName
  }


  // TODO NOT REALLY SURE WHAT THIS DOES I'm not going to touch it for now, but may need to if not working
	const tokenKey = logGroupName + '__' + logStreamName
	sequenceToken = sequenceToken || _sequenceTokens.get(tokenKey)
	if (sequenceToken)
  payload.sequenceToken = sequenceToken

  const headers = {
    headers: {
        'Content-Type': 'application/json'
      }
  }

  console.log('payload', payload);
	const request = axios.create({
		baseURL: uri,
		headers: headers
	})

	return retryCount > 3 || nothingToLog ? Promise.resolve(null) : request.post('', payload)
		.then(results => {
			//console.log('Yes')
			const token = results.data.nextSequenceToken
			_sequenceTokens.set(tokenKey, token)
		})
		.catch(err => {
			// console.log('Oops', err)
      let token = err.response.data.expectedSequenceToken
			if (token) {
				_sequenceTokens.set(tokenKey, token)
				retryCount += 1
				return addLogsToStream(entry, logGroupName, logStreamName, uri, token, retryCount)
			}
			else
				console.error(err.response.data)
		})
}

const delayFn = (fn,time) => makeQuerablePromise((new Promise((onSuccess) => setTimeout(() => onSuccess(), time))).then(() => fn()))
const makeQuerablePromise = promise => {
	// Don't modify any promise that has been already modified.
	if (promise.isResolved) return promise

	// Set initial state
	let isPending = true
	let isRejected = false
	let isFulfilled = false

	// Observe the promise, saving the fulfillment in a closure scope.
	let result = promise.then(
		v => {
			isFulfilled = true
			isPending = false
			return v
		},
		e => {
			isRejected = true
			isPending = false
			throw e
		}
	)

	result.isFulfilled = () => isFulfilled
	result.isPending = () => isPending
	result.isRejected = () => isRejected
	return result
}

const _logbuffer = new WeakMap()
const Logger = class {
	constructor({ logGroupName, logStreamName, uploadFreq, local, uri }) {
		if (!logGroupName)
			throw new Error('Missing required argument: \'logGroupName\' is required.')
		if (!logStreamName)
      throw new Error('Missing required argument: \'logStreamName\' is required.')
      if (!uri)
			throw new Error('Missing required argument: \'uri\' is required.')

		let log
		if (!uploadFreq || uploadFreq < 0) {
			log = (...args) => {

				const logs = (args || []).map(x => JSON.stringify(x))
				// console.log('Logging now...')
				addLogsToStream(logs, logGroupName, logStreamName, uri)
			}
		}
		else {
			log = (...args) => {
				// 1. Accumulate all logs
				const now = Date.now()
        const logs = (args || []).map(x => ({ message: x, timestamp: now }))

				let latestBuffer = (_logbuffer.get(this) || { latest: now, data: [], job: null })
				latestBuffer.data = latestBuffer.data.concat(logs)

				// 2. If no job has ever been started, start it, or if the job is ready to process more
				if (!latestBuffer.job || !latestBuffer.job.isPending()) {
					latestBuffer.job = makeQuerablePromise(delayFn(() => {
						const { latest, data, job } = (_logbuffer.get(this) || { latest: now, data: [], job: null })
						// console.log('Finally logging now...')
						// console.log(data)
						_logbuffer.set(this, { latest, data:[], job })
						addLogsToStream(data, logGroupName, logStreamName, uri)
					}, uploadFreq))
				}
				//console.log('Buffering logs now...')
				// 3. In any case, memoize
				_logbuffer.set(this, latestBuffer)
			}
		}

		this.log = local && local != 'false' ? console.log : log
	}
}

module.exports = {
	createLogStream,
	Logger
}