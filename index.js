// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true });
var path = require('path');
var util = require('util');
var s3 = new AWS.S3();

var THUMB_KEY_PREFIX = "players/thumbs/",
    MAX_WIDTH = 200,
    MAX_HEIGHT = 300,
    ALLOWED_FILETYPES = ['jpg', 'jpeg']; // Other extensions can be added ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'pdf', 'gif']

var utils = {
  decodeKey: function(key) {
    return decodeURIComponent(key).replace(/\+/g, ' ');
  }
};

exports.handler = function(event, context) {
    var srcBucket = event.Records[0].s3.bucket.name,
    srcKey = utils.decodeKey(event.Records[0].s3.object.key), // eg. /documents/new-document.pdf
    srcPath = path.parse(srcKey),
    fileType = srcKey.match(/\.\w+$/),
    filename = srcPath.name,
    dstKey = THUMB_KEY_PREFIX + filename + fileType;

    if (fileType === null) {
        console.error("Invalid filetype found for key: " + srcKey);
        return;
    }

    fileType = fileType[0].substr(1);

    if (ALLOWED_FILETYPES.indexOf(fileType) === -1) {
        console.error("Filetype " + fileType + " not valid for thumbnail, exiting...");
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
     // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            // Download the image from S3 into a buffer.
            s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                next);
            },
        function transform(response, next) {
            gm(response.Body).size(function(err, size) {
                // Infer the scaling factor to avoid stretching the image unnaturally.
                var scalingFactor = Math.min(
                    MAX_WIDTH / size.width,
                    MAX_HEIGHT / size.height
                );
                var width  = scalingFactor * size.width;
                var height = scalingFactor * size.height;

                // Transform the image buffer in memory.
                this.resize(width, height)
                    .toBuffer(fileType, function(err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
                        }
                    });
            });
        },
        function upload(contentType, data, next) {
            // Stream the transformed image to a different S3 bucket.
            s3.putObject({
                    Bucket: srcBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: contentType
                },
                next);
            }
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey + ' and upload to ' + srcBucket + '/' + dstKey + ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey + ' and uploaded to ' + srcBucket + '/' + dstKey
                );
            }

            context.done();
        }
    );
};