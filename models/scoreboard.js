var mongoose = require('mongoose');
var ScoreboardSchema = new mongoose.Schema({
    account: {type: String, required: true},
    question: {type: String},
    answer: {type: String},
    time: {type: String},
    status: {
        type: String,
        enum: ['correct', 'false'],
        default: 'false'

    },
    createdAt: {type: Date, default: Date.now}
});

ScoreboardSchema.index({account: 1, status: 1});

ScoreboardSchema.virtual('id')
    .get(function () {
        return this._id;
    });

module.exports = mongoose.model('Scoreboard', ScoreboardSchema);