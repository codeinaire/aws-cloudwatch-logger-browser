const { createLogStream, Logger } = require('./index');

// const logStreamConfig = {
//   uri: "https://9pxl1vw0zg.execute-api.ap-southeast-2.amazonaws.com/prod/create-stream",
//   logGroupName: 'nmm-client-group'
// }

// createLogStream('test-stream', logStreamConfig).then(data => {
//   console.log('data', data);
// }).then(error => {
//   console.log(error);
// });

const config = {
	logGroupName: 'nmm-client-group',
	logStreamName: 'test-stream',
	uploadFreq: 10000, 	// Optional. Send logs to AWS LogStream in batches after 10 seconds intervals.
  local: false, 		// Optional. If set to true, the log will fall back to the standard 'console.log'.
  uri: 'https://9pxl1vw0zg.execute-api.ap-southeast-2.amazonaws.com/prod/put-logs'
};

const logger = new Logger(config);

logger.log({type: 'intense', message: 'should work with now'})
// logger.log('working with sequence')
// logger.log('Whatever is going on here and here is it again')

