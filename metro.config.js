/**
 * Metro sizing.
 *
 * Metro runs its file transforms in a pool of worker processes, sized at (CPU cores - 1) by
 * default. On this machine that is seven `jest-worker` processes — those are Metro's, not Jest's,
 * despite the package name — each holding around 170 MB. That is roughly 1.6 GB reserved for a
 * development server that sits idle between edits, which is a large slice of a 16 GB machine to
 * give up permanently.
 *
 * Two workers keeps rebuilds responsive while cutting the pool by about 800 MB. Development
 * rebuilds only got marginally slower when measured by hand, and nothing here is a large enough
 * bundle for the transform step to be the bottleneck.
 *
 * Raise this if cold rebuilds start to drag; it trades memory back for speed.
 */
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)

config.maxWorkers = 2

module.exports = config
