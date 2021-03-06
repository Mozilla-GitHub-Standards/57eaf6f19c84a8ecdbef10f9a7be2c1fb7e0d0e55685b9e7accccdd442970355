'use strict';

const AWS = require('aws-sdk');
const qs = require('querystring');
const https = require('https');

const slackToken = process.env.slackToken;
const jenkinsToken = process.env.jenkinsToken;
const reticulumToken = process.env.reticulumToken;

let token;
let jtoken;
let rtoken;

function processEvent(event, callback) {
    const params = qs.parse(event.body);
    const requestToken = params.token;
    if (requestToken !== token) {
        console.error(`Request token (${requestToken}) does not match expected`);
        return callback('Invalid request token');
    }

    const user = params.user_name;
    const commandText = params.text;

    if (commandText.startsWith("hab promote ")) {
        const pkg = commandText.split(" ")[2].trim();
        const url = `https:\/\/ci-dev.reticulum.io/buildByToken/buildWithParameters?job=hab-promote&PACKAGE=${pkg}&CHANNEL=stable&token=${jtoken}&SOURCE=${user}`;
        https.get(url, (res) => { callback(null, "Promotion started. See #mr-push."); });
    } else if (commandText.startsWith("hubs deploy ")) {
        const buildVersion = commandText.split(" ")[2].trim();
        const s3url = commandText.split(" ")[3].trim();
        const url = `https:\/\/ci-dev.reticulum.io/buildByToken/buildWithParameters?job=hubs-deploy&S3URL=${s3url}&token=${jtoken}&SOURCE=${user}&BUILD_VERSION=${buildVersion}`;
        https.get(url, (res) => { callback(null, "Deploy started. See #mr-push."); });
    } else if (commandText.startsWith("hubs support on")) {
        const options = {
            hostname: 'hubs.mozilla.com',
            port: 443,
            path: '/api/v1/support/subscriptions',
            method: 'POST',
            headers: {
                'x-ret-admin-access-key': rtoken,
                'Content-Type': "application/json"
            }
        };

        const req = https.request(options, (res) => { callback(null, "You are now available for Hubs support requests."); });
        req.write("{ \"subscription\": { \"identifier\": \"" + user + "\" } }");
        req.end();
    } else if (commandText.startsWith("hubs support off")) {
        const options = {
            hostname: 'hubs.mozilla.com',
            port: 443,
            path: '/api/v1/support/subscriptions/' + user,
            method: 'DELETE',
            headers: {
                'x-ret-admin-access-key': rtoken,
                'Content-Type': "application/json"
            }
        };

        const req = https.request(options, (res) => { callback(null, "You are now no longer available for Hubs support requests."); });
        req.write("{ }");
        req.end();
    } else {
        callback(null, `Invalid command, try \`hab promote <package>, hubs deploy <version> <s3 target>, hubs support on, hubs support off\``);
    }
}


exports.handler = (event, context, callback) => {
    const done = (err, res) => callback(null, {
        statusCode: err ? '400' : '200',
        body: err ? (err.message || err) : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (token && jtoken && rtoken) {
        // Container reuse, simply process the event with the key in memory
        processEvent(event, done);
    } else if (slackToken && slackToken !== '<slackToken>') {
        const cipherText = { CiphertextBlob: new Buffer(slackToken, 'base64') };
        const kms = new AWS.KMS();
        kms.decrypt(cipherText, (err, data) => {
            if (err) {
                console.log('Decrypt error:', err);
                return done(err);
            }
            token = data.Plaintext.toString('ascii');

            const jcipherText = { CiphertextBlob: new Buffer(jenkinsToken, 'base64') };
            kms.decrypt(jcipherText, (err, data) => {
                if (err) {
                    console.log('Decrypt error:', err);
                    return done(err);
                }

                jtoken = data.Plaintext.toString('ascii');
                const rcipherText = { CiphertextBlob: new Buffer(reticulumToken, 'base64') };

                kms.decrypt(rcipherText, (err, data) => {
                    if (err) {
                        console.log('Decrypt error:', err);
                        return done(err);
                    }

                    rtoken = data.Plaintext.toString('ascii');
                    processEvent(event, done);
                });
            });
        });
    } else {
        done('Token has not been set.');
    }
};
