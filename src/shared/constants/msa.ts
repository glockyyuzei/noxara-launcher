/**
 * Microsoft Entra ID (Azure) public-client application ID used for the OAuth 2.0
 * device-code sign-in flow.
 *
 * This is a PUBLIC client ID for a "Public client / native" app registration — by
 * design it is embedded in every client build (like the official launcher and other
 * desktop apps do). It is NOT a secret and must never be treated as one: anyone who
 * installs the launcher already has it. Client secrets must never be added here or
 * anywhere else in this repository.
 *
 * The environment variable `NOXARA_MSA_CLIENT_ID` overrides this baked-in value so
 * a developer (or a build pipeline) can point the app at a different registration
 * without editing source.
 */
export const MSA_CLIENT_ID = "02500d3e-d02b-40e2-ace9-1a77232f6011";