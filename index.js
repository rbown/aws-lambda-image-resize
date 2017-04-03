// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();
var gm = require('gm')
    .subClass({
        imageMagick: true
    }); // Enable ImageMagick integration. Built into Lambda
var util = require('util');

var THUMB_KEY_PREFIX = "players/thumbs/";

// constants
var sizeConfigs = [{
    postfix: '_w200',
    width: 200
}, 
/*{
    postfix: '_w100',
    width: 100
}*/];

var utils = {
  decodeKey: function(key) {
    return decodeURIComponent(key).replace(/\+/g, ' ');
  }
};

exports.handler = function(event, context) {

    var bucket = event.Records[0].s3.bucket.name,
    srcKey = utils.decodeKey(event.Records[0].s3.object.key),
    dstKey = THUMB_KEY_PREFIX + srcKey.replace(/\.\w+$/, ".jpg"),
    fileType = srcKey.match(/\.\w+$/);

    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        console.error('unable to infer image type for key ' + srcKey);
        return context.fail();
    }
    
    var imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "jpeg" && imageType != "png") {
        console.log('skipping non-image ' + srcKey);
        return context.fail();
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            s3.getObject({
                    Bucket: bucket,
                    Key: srcKey
                },
                next);
        },
        function tranform(response, next) {
            async.map(sizeConfigs, resize, function(err, mapped) {
                next(err, mapped);
            });

            function resize(config, callback) {
                gm(response.Body)
                    .size(function(err, size) {
                        if(err){next(err);}
                        
                        var width = config.width;
                        var height = null;

                        this.resize(width, height)
                            .toBuffer('jpg', function(err, buffer) {
                                //  console.log('toBuffer');
                                if (err) {
                                    console.error(err);
                                    callback(err);
                                }
                                else {
                                    var obj = config;
                                    //obj.contentType = 'image/jpeg';
                                    obj.data = buffer;
                                    callback(null, obj);
                                }
                            });
                    });
            }
        },
        function upload(items, next) {

            async.each(items,
                function(item, callback) {
                    s3.putObject({
                        Bucket: bucket,
                        Key: dstKey,
                        Body: item.data,
                        ContentType: 'image/jpeg'
                    }, callback);
                },
                function(err) {
                    next(err);
                });

        }
    ], function(err) {
        if (err) {
            console.error(
                'Unable to resize ' + bucket + '/' + srcKey +
                ' and upload to ' + bucket + '/' + dstKey +
                ' due to an error: ' + err
            );
        }
        else {
            console.log(
                'Successfully resized ' + bucket + '/' + dstKey +
                ' and uploaded to ' + bucket + '/' + dstKey
            );
            context.done();
        }
    });
};