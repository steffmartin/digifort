import { createCameraPlayerClass, consumeMultipart } from './media/player.js';
import { createMediaCapture } from './media/capture.js';
import { createPlaybackReview } from './review/playback.js';
import { createTimelineReview } from './review/timeline.js';
import { createThumbnailReview } from './review/thumbnails.js';
import { epochToApi, epochToInput, inputToEpoch } from './review/time.js';
import { createPresenceAlarm } from './presence/alarm.js';

import { mountMonitor } from './monitor/shell.js';

mountMonitor({ createCameraPlayerClass, consumeMultipart, createMediaCapture, createPlaybackReview, createTimelineReview, createThumbnailReview, epochToApi, epochToInput, inputToEpoch, createPresenceAlarm });
