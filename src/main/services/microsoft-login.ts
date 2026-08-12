/**
 * Ties together auth/microsoft.ts (raw OAuth/Xbox/Minecraft calls) and
 * services/accounts.ts (persistence) into the two calls the renderer actually needs:
 *   1. start a device-code login (fast, returns immediately)
 *   2. wait for the user to finish signing in, then save the resulting account
 *
 * This file is what was missing before — auth/microsoft.ts had the real OAuth logic,
 * but nothing exposed it to the UI. This is the bridge.
 */
import * as msa from "../auth/microsoft";
import { saveMicrosoftAccount, setActiveAccount, listAccounts } from "./accounts";
import type { AccountRecord } from "../../shared/types/ipc";

export async function startMicrosoftLogin(): Promise<msa.DeviceCodeInfo> {
  return msa.requestDeviceCode();
}

/**
 * Polls until the user finishes signing in (or the device code expires / is denied),
 * then runs the full Xbox Live -> XSTS -> Minecraft Services -> profile chain and
 * persists the resulting account. Returns the saved account record.
 */
export async function completeMicrosoftLogin(
  deviceCode: string,
  pollIntervalSeconds: number,
  expiresInSeconds: number
): Promise<AccountRecord> {
  const { accessToken, refreshToken } = await msa.pollForToken(deviceCode, pollIntervalSeconds, expiresInSeconds);
  const session = await msa.completeMinecraftLogin(accessToken, refreshToken);
  // The Minecraft access token is passed along so the account row can embed a real
  // avatar (cropped skin head) immediately — never a disposable third-party URL.
  const account = await saveMicrosoftAccount(
    session.minecraftUsername,
    session.minecraftUuid,
    session.msaRefreshToken,
    session.minecraftAccessToken
  );

  // A freshly added account should become active immediately, matching how offline
  // profile creation already behaves — the person just went through a login flow,
  // they expect to be playing as that account now.
  setActiveAccount(account.id);
  return listAccounts().find((a) => a.id === account.id) ?? account;
}
