"""Python 3.10+: python examples/client.py

Unpaid local extraction by default. Does not generate or sign payments.
Optional --paid sends FRESH402_PAYMENT_SIGNATURE supplied by a local x402 wallet.
"""
import base64
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    """Do not forward a payment signature to a redirected API endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main() -> int:
    base = os.environ.get("FRESH402_BASE_URL", "http://localhost:8787").rstrip("/")
    target = os.environ.get("FRESH402_TARGET_URL", "https://example.com/")
    headers = {"Content-Type": "application/json"}
    recovery_token = os.environ.get("FRESH402_RECOVERY_TOKEN")
    if recovery_token:
        headers["X-Fresh402-Recovery-Token"] = recovery_token
    if os.environ.get("FRESH402_STAGING_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["FRESH402_STAGING_TOKEN"]
    if "--paid" in sys.argv:
        payment = os.environ.get("FRESH402_PAYMENT_SIGNATURE")
        if not payment:
            print("Supply a locally generated x402 payload, never a wallet private key.", file=sys.stderr)
            return 1
        headers["PAYMENT-SIGNATURE"] = payment
        if not recovery_token:
            print("Save FRESH402_RECOVERY_TOKEN (32 random bytes as hex/base64url) before paying.", file=sys.stderr)
            return 1
    request = Request(base + "/v2/extract", data=json.dumps({"url": target, "max_chars": 20000}).encode(), headers=headers, method="POST")
    try:
        with build_opener(NoRedirect).open(request, timeout=60) as response:
            print(json.loads(response.read(524289)))
            print("Settlement receipt present:", bool(response.headers.get("PAYMENT-RESPONSE")))
    except HTTPError as error:
        if error.code == 402 and error.headers.get("PAYMENT-REQUIRED"):
            challenge = json.loads(base64.b64decode(error.headers["PAYMENT-REQUIRED"]))
            offer = challenge["accepts"][0]
            if challenge.get("x402Version") != 2 or offer.get("scheme") != "exact" or offer.get("network") != "eip155:8453" or offer.get("amount") != "10000":
                print("Unexpected price or network", file=sys.stderr)
                return 1
            print("Payment required; no sale occurred:", offer)
            print("Inspect recipient, asset and spend policy in your x402 wallet client. No automatic signing or retry.")
            return 0
        print("Fresh402 error", error.code, error.read(4096).decode(errors="replace"), file=sys.stderr)
        return 1
    except URLError:
        print("Cannot reach the local Fresh402 endpoint.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
