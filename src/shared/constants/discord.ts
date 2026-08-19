/**
 * Discord application ID used for Rich Presence (SET_ACTIVITY over Discord's local
 * IPC pipe). It is PUBLIC — Discord application ids are never secrets — and it is
 * embedded in every client build so Rich Presence works out of the box for end
 * users even when no `.env` file is present in the packaged app.
 *
 * The environment variable `NOXARA_DISCORD_APP_ID` overrides this baked-in value so
 * a fork (or a build pipeline) can point the app at its own Discord application
 * without editing source.
 */
export const DISCORD_APP_ID = "1538728135795941497";