import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import type { JsonRpcResponse } from "./types.js";
import { SeestarClient } from "./client.js";
import type { Logger } from "./logging.js";
import { createNoopLogger, emitLog } from "./logging.js";

/**
 * Authentication helper for Seestar firmware 7.18+.
 * Performs RSA PKCS#1 v1.5 SHA1 challenge-response handshake.
 */
export class SeestarAuth {
  private logger: Logger;

  constructor(
    private client: SeestarClient,
    private pemPath: string,
    private host: string,
    logger?: Logger,
    private sessionId?: string,
    private deviceModel?: string,
    private deviceSn?: string
  ) {
    this.logger = logger ?? createNoopLogger();
  }

  async authenticate(): Promise<boolean> {
    emitLog(this.logger, {
      level: "info",
      event: "auth.handshake.started",
      component: "auth",
      phase: "connect",
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      summary: "Started authentication handshake",
    });

    // Step 1: Get challenge
    const challengeResp = await this.client.sendSync("get_verify_str", "");
    const challenge = extractChallenge(challengeResp);
    if (!challenge) {
      emitLog(this.logger, {
        level: "error",
        event: "auth.handshake.failed",
        component: "auth",
        phase: "connect",
        sessionId: this.sessionId,
        host: this.host,
        deviceModel: this.deviceModel,
        deviceSn: this.deviceSn,
        summary: "Authentication challenge was not returned by device",
        error: "No challenge string received",
      });
      return false;
    }

    emitLog(this.logger, {
      level: "debug",
      event: "auth.challenge.received",
      component: "auth",
      phase: "connect",
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      summary: "Received authentication challenge",
      data: { challengeLength: challenge.length },
    });

    // Step 2: Sign challenge
    const pem = readFileSync(this.pemPath);
    const signer = createSign("RSA-SHA1");
    signer.update(challenge);
    const signature = signer.sign(pem, "base64");

    // Step 3: Send verification
    const verifyResp = await this.client.sendSync("verify_client", {
      sign: signature,
      data: challenge,
    });
    if (!isOk(verifyResp)) {
      emitLog(this.logger, {
        level: "error",
        event: "auth.handshake.failed",
        component: "auth",
        phase: "connect",
        sessionId: this.sessionId,
        host: this.host,
        deviceModel: this.deviceModel,
        deviceSn: this.deviceSn,
        summary: "Device rejected authentication signature",
        error: verifyResp.error,
        data: { code: verifyResp.code },
      });
      return false;
    }

    // Step 4: Sanity check
    const verifiedResp = await this.client.sendSync("pi_is_verified", "");
    const isVerified = checkVerified(verifiedResp);

    if (!isVerified) {
      emitLog(this.logger, {
        level: "error",
        event: "auth.handshake.failed",
        component: "auth",
        phase: "connect",
        sessionId: this.sessionId,
        host: this.host,
        deviceModel: this.deviceModel,
        deviceSn: this.deviceSn,
        summary: "Device did not report verified state after authentication",
        data: { code: verifiedResp.code },
      });
      return false;
    }

    emitLog(this.logger, {
      level: "info",
      event: "auth.handshake.succeeded",
      component: "auth",
      phase: "connect",
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      summary: "Authenticated with device",
    });

    return true;
  }

  setDeviceIdentity(deviceModel?: string, deviceSn?: string): void {
    this.deviceModel = deviceModel;
    this.deviceSn = deviceSn;
  }
}

function extractChallenge(resp: JsonRpcResponse): string | null {
  if (
    typeof resp.result === "object" &&
    resp.result !== null &&
    "str" in (resp.result as Record<string, unknown>)
  ) {
    return String((resp.result as Record<string, unknown>).str);
  }
  return null;
}

function isOk(resp: JsonRpcResponse): boolean {
  return resp.code === 0 || (resp.result === 0 && !resp.error);
}

function checkVerified(resp: JsonRpcResponse): boolean {
  if (resp.result === true) return true;
  if (
    typeof resp.result === "object" &&
    resp.result !== null &&
    (resp.result as Record<string, unknown>).is_verified === true
  ) {
    return true;
  }
  return false;
}
