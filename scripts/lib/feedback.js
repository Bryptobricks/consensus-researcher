#!/usr/bin/env node
'use strict';

/**
 * Scoring calibration & feedback loop.
 * Tracks user satisfaction vs predicted scores to improve future accuracy.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { dirname, resolve } = require('path');

const FEEDBACK_PATH = resolve(process.cwd(), 'data/feedback.json');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function loadFeedback() {
  if (!existsSync(FEEDBACK_PATH)) {
    return { entries: [], calibration: null };
  }
  try {
    return JSON.parse(readFileSync(FEEDBACK_PATH, 'utf8'));
  } catch {
    return { entries: [], calibration: null };
  }
}

function saveFeedback(data) {
  ensureDir(dirname(FEEDBACK_PATH));
  writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function generateId() {
  return `fb-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Find the most recent research result for a product.
 * Checks memory/research/ for matching JSON files.
 */
function findResearchForProduct(product) {
  const researchDir = resolve(process.cwd(), 'memory/research');
  if (!existsSync(researchDir)) return null;

  const { readdirSync } = require('fs');
  const files = readdirSync(researchDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const slug = product.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  for (const file of files) {
    if (file.includes(slug)) {
      try {
        const data = JSON.parse(readFileSync(resolve(researchDir, file), 'utf8'));
        return {
          file,
          score: data.draftScore?.brandScores
            ? Math.max(...Object.values(data.draftScore.brandScores))
            : null,
          topPick: data.draftScore?.topPick || null,
          confidence: data.draftScore?.confidence || data.dataSufficiency || null,
          date: data.timestamp ? data.timestamp.split('T')[0] : null
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function addFeedback(product, satisfaction, opts = {}) {
  if (satisfaction < 1 || satisfaction > 10) {
    throw new Error('Satisfaction must be 1-10');
  }

  const data = loadFeedback();
  const research = findResearchForProduct(product);

  const entry = {
    id: generateId(),
    product,
    researchSlug: research?.file?.replace('.json', '') || null,
    researchScore: research?.score || null,
    researchConfidence: research?.confidence || null,
    satisfaction,
    notes: opts.notes || null,
    purchasedBrand: opts.brand || research?.topPick || null,
    feedbackDate: new Date().toISOString().split('T')[0],
    deltaFromPrediction: research?.score != null ? round(satisfaction - research.score) : null
  };

  data.entries.push(entry);

  // Recalibrate if we have enough data
  if (data.entries.length >= 5) {
    data.calibration = calibrate(data.entries);
  }

  saveFeedback(data);
  return entry;
}

function calibrate(entries) {
  const withDelta = entries.filter(e => e.deltaFromPrediction != null);
  if (withDelta.length < 3) return null;

  const deltas = withDelta.map(e => e.deltaFromPrediction);
  const avgDelta = round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  const avgAbsDelta = round(deltas.map(Math.abs).reduce((a, b) => a + b, 0) / deltas.length);

  // Determine if we're systematically over/under-predicting
  let bias = 'accurate';
  if (avgDelta > 0.5) bias = 'pessimistic'; // scores too low (satisfaction higher)
  else if (avgDelta < -0.5) bias = 'optimistic'; // scores too high (satisfaction lower)

  return {
    avgDelta,
    avgAbsDelta,
    bias,
    sampleSize: withDelta.length,
    lastCalibrated: new Date().toISOString().split('T')[0]
  };
}

function getCalibrationNote() {
  const data = loadFeedback();
  if (!data.calibration || data.calibration.sampleSize < 5) return null;

  const cal = data.calibration;
  if (cal.bias === 'accurate') {
    return `Calibration: based on ${cal.sampleSize} past purchases, scores are accurate (avg deviation: ${cal.avgAbsDelta.toFixed(1)} points)`;
  }
  if (cal.bias === 'optimistic') {
    return `Calibration: based on ${cal.sampleSize} past purchases, scores tend to be optimistic by ~${Math.abs(cal.avgDelta).toFixed(1)} points`;
  }
  return `Calibration: based on ${cal.sampleSize} past purchases, scores tend to be pessimistic by ~${cal.avgDelta.toFixed(1)} points`;
}

function getFeedbackSummary() {
  const data = loadFeedback();
  const lines = [`Feedback entries: ${data.entries.length}`];

  if (data.calibration) {
    const cal = data.calibration;
    lines.push(`Calibration: ${cal.bias} (avg delta: ${cal.avgDelta > 0 ? '+' : ''}${cal.avgDelta.toFixed(1)}, sample: ${cal.sampleSize})`);
  } else {
    lines.push(`Calibration: not enough data (need ${5 - data.entries.length} more entries)`);
  }

  return lines.join('\n');
}

module.exports = {
  addFeedback,
  getCalibrationNote,
  getFeedbackSummary,
  loadFeedback
};
