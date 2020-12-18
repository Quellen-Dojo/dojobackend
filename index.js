const firebase = require('firebase/app');
// require('firebase/firestore'); //I dont think we'll need this atm

const firebaseConfig = {
    apiKey: "AIzaSyAriMlY99iSs-gG3hHYnU7Kb1ogj3i2THg",
    authDomain: "dojobackend-a8b59.firebaseapp.com",
    projectId: "dojobackend-a8b59",
    storageBucket: "dojobackend-a8b59.appspot.com",
    messagingSenderId: "297942814237",
    appId: "1:297942814237:web:1ca2dd612c29e23a3540f4",
    measurementId: "G-GG8PNZ82FS"
  };

firebase.initializeApp(firebaseConfig);

const mongoose = require('mongoose');
const express = require('express');
const app = express();
const cors = require('cors');
app.use(cors());
const discordOauth2 = require('discord-oauth2');
const oauth = new discordOauth2();

mongoose.connect('mongodb+srv://quellen:thedojo123@cluster0.jxtal.mongodb.net/dojodb?retryWrites=true&w=majority',{useNewUrlParser:true,useUnifiedTopology:true})
let port = process.env.PORT || 3000;

//BI Player Model
const BIPlayerSchema = new mongoose.Schema({
    discordUsername: String,
    steamID: String
})

const BIPlayer = mongoose.model('BIPlayer',BIPlayerSchema);

// app.get('/test',(req,res) => {
//     const {user,id} = req.query;
//     const newPlayer = BIPlayer.create({discordUsername:user,steamID:id}).catch(e => {
//         res.status(500).send('Server Error');
//     });
//     res.send('Done!');
// });

app.get('/five',(req,res) => {
    res.status(500).send();
});

app.get('/sign',(req,res) => {
    const code = req.query['code'];
    console.log(`Sending code ${code} to discord...`);
    //First discord request
    const data = {
        clientId: '753807367484735568',
        clientSecret: process.env.clientSecret,
        grantType: 'authorization_code',
        code: code,
        redirectUri: process.env.redirectUri || 'http://127.0.0.1:5500/signupnext.html',
        scope: 'connections identify'
    };

    // const inst = axios.create({
    //     baseURL: 'https://discord.com/api/',
    //     timeout: 1000,
    //     headers: {'Content-Type':'application/x-www-form-urlencoded'}
    // });
    // inst.post('/oauth2/token',data).then(res => {
    //     console.log(res.status);
    // });

    // const config = {
    //     method:'post',
    //     url: 'https://discord.com/api/oauth2/token',
    //     headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    //     data: data,
    // }

    // axios.post('https://discord.com/api/oauth2/token',JSON.stringify(data),{headers:{'Content-Type':'application/x-www-form-urlencoded'}}).then(res => {
    //     console.log(res.status);
    // }).catch(err => {
    //     console.log('Error on request from discord...');
    // });
    let userName = '';
    let id = 0;
    let jsonRes = {
        got_code: false,
        has_discord: false,
        has_steam: false,
        already_exists: false
    }
    oauth.tokenRequest(data).then(res1 => {
        jsonRes.got_code = true;
        oauth.getUser(res1.access_token).then(res2 => {
            userName = res2.username+'#'+res2.discriminator;
            jsonRes.has_discord = true;
            oauth.getUserConnections(res1.access_token).then(res3 => {
                console.log(res3);

                for (const conn of res3) {
                    if (conn.type == 'steam') {
                        id = parseInt(conn.id);
                        jsonRes.has_steam = true;
                        break;
                    }
                }

                //No Steam connection
                if (id === 0) {
                    res.json(jsonRes);
                    return;
                }

                //Check for existing player and add:
                //d will have _doc which contains _id and the fields discordUsername and steamID
                BIPlayer.findOne({steamID:id},(err,d) => {
                    if (d !== null) {
                        jsonRes.already_exists = true;
                        res.json(jsonRes);
                    } else {
                        BIPlayer.create({discordUsername:userName,steamID:id}).then(() => {
                            res.json(jsonRes);
                        }).catch(e => {
                            console.log('Error on creating BIPlayer?');
                            res.status(500).send();
                        });
                    }
                    
                });
                
            }).catch(() => res.status(500).send())
        }).catch(() => res.status(500).send());
    }).catch(() => {
        console.log('Error from Discord...');
        res.status(500).send();
    });
});

app.listen(port,() => {
    console.log('App listening');
});