# Market Sound V1 Design

Last updated: March 24, 2026

## 1. Goal

Add a TikTok-style sound system to Market posts without importing TikTok's licensing risk.

V1 must:

- Let sellers create video posts with reusable sounds.
- Let viewers tap a sound, open a sound page, preview it, save it, and reuse it.
- Ensure only the active feed item plays audio.
- Keep creation flow simple enough for the current product and user base.

V1 must not:

- Ship unlicensed mainstream music.
- Depend on a large editorial music catalog.
- Introduce heavy creator tools that slow down posting.

## 2. Product Principles

- Sound is a first-class object, not just an `audioUrl` attached to one post.
- One post owns one primary sound.
- One sound can be reused by many posts.
- Video is the primary media type for sound posts.
- Image-only posts remain supported and unchanged.

## 3. Supported Sound Sources in V1

V1 supports only safe audio sources:

- `original_video_audio`: audio extracted from the creator's uploaded video.
- `uploaded_owned_audio`: an audio file the creator uploads and asserts they own or are allowed to use.
- `ikm_internal_sound`: a previously created sound already stored in IKM and available for reuse.

V1 does not support:

- Mainstream song search.
- Third-party streaming catalogs.
- Label-licensed public music libraries inside the app.

## 4. User-Facing Surfaces

### 4.1 Create Post Flow

New media entry options:

- `Photo Post`
- `Video Post`

If `Photo Post`:

- Current flow stays almost the same.
- No sound picker shown.

If `Video Post`:

- User selects or records a single video.
- App generates a poster frame.
- User can:
  - `Keep Original Sound`
  - `Upload Sound`
  - `Pick Existing Sound`
  - `Mute Video Audio`

Sound controls on create screen:

- Sound title
- 15s / 30s / 60s clip range
- start time trim
- sound volume
- original video volume
- preview play/pause

Bottom CTA:

- `Publish`

### 4.2 Feed Post Card

For video posts:

- Video fills the feed card.
- Only one post is active and audible at a time.
- Sound pill appears above the lower metadata area.
- Tapping the sound pill opens the sound detail page.

Sound pill layout:

- note icon
- sound title
- optional creator label
- small animation/equalizer when active

### 4.3 Sound Detail Screen

Purpose:

- This is the TikTok-style sound page for IKM.

Header:

- cover art or sound artwork
- sound title
- creator name
- use count
- duration

Actions:

- `Use this sound`
- `Save sound`
- `Share`
- `Report`

Body:

- feed/list of public posts using this sound

### 4.4 Saved Sounds Screen

Inside Market profile/settings:

- `Saved Sounds`

This screen shows:

- recently saved sounds
- creator-owned sounds
- recently used sounds

### 4.5 Edit Post Sound

For the owner of a video post:

- replace sound
- change trim
- change sound volume
- mute/unmute original audio

Changing the sound does not create a new post.
It updates the post and sound usage counters.

## 5. Information Architecture

## 5.1 New Routes

- `/(market)/create-post` gains media mode selection
- `/(market)/sound/[soundId]`
- `/(market)/saved-sounds`
- optional: `/(market)/edit-sound/[postId]`

## 5.2 Existing Routes Affected

- `/(market)/index`
- `/(market)/profile`
- `/(market)/create-post`
- `/(market)/post/[id]`

## 6. Data Model

## 6.1 New `marketSounds` Collection

```ts
type MarketSound = {
  id?: string;
  title: string;
  sourceType: 'original_video_audio' | 'uploaded_owned_audio' | 'ikm_internal_sound';
  creatorId: string;
  creatorDisplayName?: string;
  audioUrl: string;
  artworkUrl?: string;
  durationMs: number;
  clipStartMs: number;
  clipEndMs: number;
  rightsStatus: 'owned' | 'creator-asserted' | 'restricted' | 'muted';
  status: 'active' | 'removed' | 'hidden';
  usageCount: number;
  saveCount: number;
  createdFromPostId?: string;
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
};
```

## 6.2 `MarketPost` Extension

```ts
type MarketPostMediaType = 'image_gallery' | 'video';

type MarketPostVideoMeta = {
  videoUrl: string;
  coverImageUrl: string;
  durationMs: number;
  aspectRatio?: number;
  originalAudioUrl?: string;
  originalAudioMuted?: boolean;
};

type MarketPostSoundMeta = {
  soundId?: string;
  soundTitle?: string;
  soundStartMs?: number;
  soundEndMs?: number;
  soundVolume?: number;
  originalAudioVolume?: number;
};
```

Add to `MarketPost`:

- `mediaType`
- `videoMeta?`
- `soundMeta?`

## 6.3 User Sound Relations

Store lightweight relations:

`users/{uid}/savedSounds/{soundId}`

```ts
type SavedSound = {
  soundId: string;
  savedAt: Timestamp | Date;
};
```

Optional:

`users/{uid}/recentSounds/{soundId}`

## 7. Storage Layout

Use Firebase Storage paths:

- `market/posts/{uid}/videos/{postId}.mp4`
- `market/posts/{uid}/covers/{postId}.jpg`
- `market/sounds/{uid}/{soundId}.m4a`
- `market/sounds/{uid}/artwork/{soundId}.jpg`

Rules:

- Post owner can upload their own source media.
- Public reads for published active media.
- Sound/audio deletion should soft-disable first, not hard delete immediately.

## 8. Playback System

## 8.1 Feed Playback Rules

- Only the visible feed item may autoplay.
- When a new post becomes active:
  - previous video pauses
  - previous sound pauses
  - new active post starts
- If post is image-only:
  - no audio session starts
- If post is video with sound:
  - video starts
  - sound behavior follows `original audio` and `selected sound` mix settings

## 8.2 Audio Priority Rules

- `selected sound` is primary if present.
- `original video audio` is secondary and mixed according to `originalAudioVolume`.
- If `originalAudioMuted = true`, only the selected sound plays.
- If there is no selected sound, original video audio plays by default.

## 8.3 Mute / Unmute

Feed-level mute behavior:

- one global feed mute setting
- user can mute/unmute quickly
- state persists locally

## 8.4 Preloading

- Preload current, next, and previous video only.
- Preload selected sound metadata but not the entire sound library.
- Keep aggressive cleanup on feed scroll to avoid memory pressure.

## 9. Post Creation UX

## 9.1 Video Post Steps

Step 1:

- pick or record video

Step 2:

- choose sound source
  - keep original
  - upload owned audio
  - pick existing IKM sound

Step 3:

- preview and trim
- set volumes

Step 4:

- caption
- hashtags
- price
- negotiable
- location

Step 5:

- publish

## 9.2 Validation Rules

- video required for sound-enabled post
- max duration: 60 seconds in V1
- max audio file duration: 60 seconds in V1
- allowed audio formats: `m4a`, `mp3`, `aac`
- sound title required for uploaded audio
- creator must confirm ownership/usage rights for uploaded audio

## 10. Sound Detail UX

## 10.1 Header

- artwork or video cover
- sound title
- creator
- usage count
- save count

## 10.2 Actions

- `Use this sound`
- `Save`
- `Share`
- `Report`

## 10.3 Body Feed

- public posts using this sound
- newest first
- optional tab later:
  - `Top`
  - `Recent`

## 11. API / Backend Contract

## 11.1 New APIs

- `marketSoundsApi.createFromVideoAudio()`
- `marketSoundsApi.uploadOwnedSound()`
- `marketSoundsApi.getSound(soundId)`
- `marketSoundsApi.listPostsBySound(soundId)`
- `marketSoundsApi.saveSound(soundId)`
- `marketSoundsApi.unsaveSound(soundId)`
- `marketSoundsApi.incrementUsage(soundId)`
- `marketSoundsApi.reportSound(soundId, reason)`

## 11.2 Existing API Changes

`marketPostsApi.create()` must support:

- `mediaType`
- `videoUri`
- `coverImageUri`
- `soundSelection`

Cloud Function for post creation must:

- upload video
- upload cover
- create or attach selected sound
- write `soundMeta`
- increment sound usage once publish succeeds

## 11.3 Idempotency

Required for publish:

- `clientPostId`
- `clientSoundDraftId`

If publish retries after bad network:

- do not create duplicate sounds
- do not create duplicate posts

## 12. Moderation and Rights

## 12.1 Rights Assertion

For uploaded owned audio, user must check:

- `I own this audio or I have permission to use it`

Store:

- `rightsStatus = creator-asserted`

## 12.2 Admin Controls

Admins need:

- mute sound
- hide sound page
- remove sound from discovery
- remove sound from all affected posts if necessary

## 12.3 Fallback Behavior

If a sound is removed:

- post still exists
- sound pill shows `Sound unavailable`
- video can fall back to original audio if allowed

## 13. Search and Discovery

V1 discovery sources:

- sound page reuse
- saved sounds
- recently used sounds
- creator-owned sounds

V1 does not need:

- trending songs chart
- genre playlists
- editorial recommendations

Those are V2.

## 14. Analytics

Track:

- sound saves
- sound uses
- post publish with sound
- video completion rate
- tap-through on sound pill
- sound-to-post conversion

Business value:

- identify which sounds create more DM starts, offers, and orders

## 15. Performance Constraints

Because the market feed is already one-item-per-screen:

- do not mount multiple active audio/video players
- use one active player per visible item
- keep feed scrolling strict and deterministic
- image-only posts should remain lightweight

## 16. Technical Rollout Plan

### Phase 1: Data + Playback Foundation

- extend `MarketPost` schema
- add `marketSounds` collection
- add video post rendering in feed
- add active-item playback manager

### Phase 2: Create Flow

- video picker
- audio picker
- sound trim + volume
- publish pipeline

### Phase 3: Reuse Flow

- sound detail page
- save sound
- use this sound
- posts-by-sound feed

### Phase 4: Moderation + Metrics

- sound reporting
- admin muting/removal
- analytics counters

## 17. V1 Out of Scope

- licensed public music catalog
- duet/remix
- collaborative sounds
- advanced beat sync
- waveform editor
- desktop creator studio
- AI voice effects
- automatic lyrics sync

## 18. Repo Impact

Current files most affected:

- `types/index.ts`
- `app/(market)/create-post.tsx`
- `app/(market)/index.tsx`
- `components/market/feed-card.tsx`
- `components/market/post-overlay.tsx`
- `lib/api/market-posts.ts`
- `lib/firebase/firestore/market-posts.ts`
- `lib/utils/image-upload.ts`

New files likely needed:

- `app/(market)/sound/[soundId].tsx`
- `app/(market)/saved-sounds.tsx`
- `components/market/sound-pill.tsx`
- `components/market/sound-picker-modal.tsx`
- `components/market/video-feed-card.tsx`
- `lib/api/market-sounds.ts`
- `lib/firebase/firestore/market-sounds.ts`
- `lib/hooks/use-active-feed-media.ts`

## 19. Best V1 Decision

The correct V1 is:

- `image posts` stay as they are
- `video posts` get TikTok-style sound behavior
- sounds are reusable app objects
- only original/owned/internal sounds are allowed

That gives the TikTok feel while staying legally safe and technically achievable.
