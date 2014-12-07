var config = require('./config.js')
    , util = require('util')
    , path = require('path')
    , express = require('express')
    , mongoose = require('mongoose')
    , swig = require('swig')
    , Twit = require('twit');

// database connection
mongoose.connect(config.mongoose.uri);
var db = mongoose.connection;

db.on('error', function (err) {
    console.log('connection error:', err.message);
});
db.once('open', function callback() {
    console.log("Connected to DB!");
});
var Scoreboard = require('./models/scoreboard');

var app = express();
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.use(express.static(path.join(__dirname, 'static')));
app.set('view cache', false);
swig.setDefaults({cache: false});

// set main request
app.get('/', function (req, res) {
    Scoreboard.aggregate([
        {
            $group: {
                _id: {account: '$account'}
                , correct: {$sum: {$cond: [{$eq: ['correct', '$status']}, 1, 0]}}
                , false: {$sum: {$cond: [{$eq: ['correct', '$status']}, 0, 1]}}
                , score: {$sum: {$cond: [{$eq: ['correct', '$status']}, 1, -0.25]}}
            }
        },
        {
            $sort: {
                score: -1
            }
        },
        {$limit: 10}])
        .exec(function (err, sb) {
            console.log('sb', sb);
            res.render('index', {scoreboard: sb});
        });
})
;

app.set('port', config.port || 8080);
app.listen(app.get('port'), function () {
    console.log('Listening on port %d', this.address().port);
});

// twitter automaton
var T = new Twit({
    consumer_key: config.consumer_key
    , consumer_secret: config.consumer_secret
    , access_token: config.access_token
    , access_token_secret: config.access_token_secret
})

var time_format = function (seconds) {
    var sec_num = parseInt(seconds, 10); // don't forget the second param
    var hours = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours < 10) {
        hours = "0" + hours;
    }
    if (minutes < 10) {
        minutes = "0" + minutes;
    }
    if (seconds < 10) {
        seconds = "0" + seconds;
    }
    var time = hours + ':' + minutes + ':' + seconds;
    return time;
}


// Application logic

var error_count = 0;
var current_answer;
var current_question;
var last_time;
var create_question = function () {
    var number_one = ((Math.floor(Math.random() * 15000) + 1) % 200) + 1;
    var number_two = ((Math.floor(Math.random() * 15000) + 1) % 100) + 1;
    var number_three = ((Math.floor(Math.random() * 15000) + 1) % 40) + 1;
    var number_four = ((Math.floor(Math.random() * 15000) + 1) % 60) + 1;
    var number_five = ((Math.floor(Math.random() * 15000) + 1) % 7) + 2;

    if (number_two > number_one) {
        var temp = number_one;
        number_one = number_two;
        number_two = temp;
    }
    var operation = Math.floor(Math.random() * 6) + 1;
    switch (operation) {
        case 1:
            question = util.format("%s+%s", number_one, number_two);
            break;
        case 2:
            question = util.format("%s*%s", number_one, number_five);
            break;
        case 3:
            question = util.format("%s-%s", number_one, number_two);
            break;
        case 4:
            question = util.format("%s+(%s*%s-%s)-%s", number_one, number_four, number_five, number_three, number_two);
            break;
        case 5:
            question = util.format("%s+(%s*%s)", number_four, number_three, number_five);
            break;
        case 6:
            question = util.format("%s*(%s-%s)", number_five, number_one, number_two);
            break;
    }

    current_question = question;
    current_answer = eval(question);
    last_time = new Date();

    // ara sıra gelen undefinedlar ve negatif cevaplı soruları tekrar üretmek için...

        if(question === undefined || typeof(question) == "undefined" || current_answer<0) {
            create_question();
        } else {
            return question;
        }


    //

}

var send_question = function () {
    var question = create_question();
    T.post('statuses/update', {status: question + " kaç eder ?"}, function (err, data, response) {
        if (err) {
            error_count++;
            console.log(err);
            if (error_count < 30)  send_question();
        } else {
            console.log("Soru gonderildi :  " + question);
        }
    });
}

var correct_answer = function (tweet, answer) {
    var sender = tweet.user.screen_name;
    var tweet_id = tweet.id_str;
    // Zaman işlemleri
    time = tweet.created_at;
    time = time.replace(/\.\d+/, ""); // remove milliseconds
    time = time.replace(/-/, "/").replace(/-/, "/");
    time = time.replace(/T/, " ").replace(/Z/, " UTC");
    time = time.replace(/([\+\-]\d\d)\:?(\d\d)/, " $1$2"); // -04:00 -> -0400
    time = new Date(time * 1000 || time);

    var seconds = (( time - last_time.getTime() ) * .001) >> 0;
    var time_diff = time_format(seconds);

    // db record
    var scoreboard = new Scoreboard({
        account: tweet.user.screen_name
        , question: current_question
        , answer: answer
        , time: time_diff
        , status: 'correct'
    })
        .save(function (err) {
            console.log(err);
        });

    // Cevap verelim
    var reply_tweet = util.format("Tebrikler @%s doğru cevap verdin ! (%s) = %s | Süre : %s", sender, current_question, current_answer, time_diff);

    T.post('statuses/update', {in_reply_to_status_id: tweet_id, status: reply_tweet}, function (err, data, response) {
        if (err) console.log("Tweet gönderilirken bir hata oluştu !");
        else {
            console.log(sender + " isimli kullanici " + current_question + " sorusunu bildi - sonuc : " + current_answer);
        }
        send_question();
    });

}

var false_answer = function (tweet, answer) {
    var sender = tweet.user.screen_name;
    // Zaman işlemleri
    time = tweet.created_at;
    time = time.replace(/\.\d+/, ""); // remove milliseconds
    time = time.replace(/-/, "/").replace(/-/, "/");
    time = time.replace(/T/, " ").replace(/Z/, " UTC");
    time = time.replace(/([\+\-]\d\d)\:?(\d\d)/, " $1$2"); // -04:00 -> -0400
    time = new Date(time * 1000 || time);

    var seconds = (( time - last_time.getTime() ) * .001) >> 0;
    var time_diff = time_format(seconds);

    // db record
    var scoreboard = new Scoreboard({
        account: sender
        , question: current_question
        , answer: answer
        , time: time_diff
        , status: 'false'
    })
        .save(function (err) {
            console.log(err);
        });
}

// Application engine

send_question();

var stream = T.stream('statuses/filter', {track: '@' + config.username}); // hesabımıza gelen mentionları izlemek için bir stream başlatalım

stream.on('tweet', function (tweet) { // başlattığımız stream'e yeni tweet düştüğü zaman çalışacak event
    var text = tweet.text;
    var notice = util.format("@%s : %s", tweet.user.screen_name, text);

    var answer = text.replace(/\D/g, ''); // gelen tweet'in sadece numerik halini alalım

    if (answer == current_answer) { // sonuç doğru ise
        correct_answer(tweet, text);
    } else {
        false_answer(tweet, text);
    }
})
