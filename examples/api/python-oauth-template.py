"""
athenahealth API Integration Template — Python
================================================
Complete OAuth2 client credentials flow with:
- Token caching and automatic refresh
- Exponential backoff + jitter for rate limiting (429)
- Error handling for all common HTTP status codes
- X-Request-Id headers for tracing
- Externalized credentials via environment variables

Usage:
    export ATHENA_CLIENT_ID=your_client_id
    export ATHENA_CLIENT_SECRET=your_client_secret
    export ATHENA_PRACTICE_ID=195900          # Sandbox practice
    export ATHENA_BASE_URL=https://api.preview.platform.athenahealth.com

    python python-oauth-template.py
"""

import os
import time
import uuid
import logging
from typing import Any

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — all externalized, never hardcoded
# ---------------------------------------------------------------------------
CLIENT_ID = os.environ["ATHENA_CLIENT_ID"]
CLIENT_SECRET = os.environ["ATHENA_CLIENT_SECRET"]
PRACTICE_ID = os.environ.get("ATHENA_PRACTICE_ID", "195900")  # Default: sandbox
BASE_URL = os.environ.get(
    "ATHENA_BASE_URL",
    "https://api.preview.platform.athenahealth.com",  # Sandbox
)
TOKEN_URL = f"{BASE_URL}/oauth2/v1/token"


# ---------------------------------------------------------------------------
# Token management — cache and auto-refresh
# ---------------------------------------------------------------------------
class TokenManager:
    """Manages OAuth2 tokens with caching and automatic refresh."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._expires_at: float = 0

    def get_token(self) -> str:
        """Return a valid access token, refreshing if needed."""
        if self._token and time.time() < self._expires_at - 60:
            return self._token  # Still valid (with 60s buffer)

        logger.info("Requesting new OAuth2 token...")
        resp = requests.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials", "scope": "athenaNet"},
            auth=(CLIENT_ID, CLIENT_SECRET),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._expires_at = time.time() + data.get("expires_in", 3600)
        logger.info("Token acquired (expires in %ds)", data.get("expires_in", 3600))
        return self._token


token_manager = TokenManager()


# ---------------------------------------------------------------------------
# API client — retry, backoff, tracing
# ---------------------------------------------------------------------------
def athena_request(
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    max_retries: int = 5,
) -> requests.Response:
    """
    Make an authenticated request to the athenahealth API.

    Includes:
    - OAuth2 bearer token (auto-refreshed)
    - X-Request-Id for tracing
    - Exponential backoff + jitter for 429 rate limits
    - Error handling for common status codes
    """
    url = f"{BASE_URL}/v1/{PRACTICE_ID}/{path.lstrip('/')}"

    for attempt in range(max_retries):
        request_id = str(uuid.uuid4())
        headers = {
            "Authorization": f"Bearer {token_manager.get_token()}",
            "X-Request-Id": request_id,  # Required for tracing and debug support
            "Accept": "application/json",
        }

        logger.debug("Request %s %s (attempt %d, rid=%s)", method, url, attempt + 1, request_id)

        try:
            resp = requests.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=30,
            )
        except requests.RequestException as e:
            logger.warning("Network error (attempt %d): %s", attempt + 1, e)
            if attempt < max_retries - 1:
                _backoff(attempt)
                continue
            raise

        # Handle specific status codes
        if resp.status_code == 429:
            # Rate limited — athenahealth limits ~10 req/sec per practice
            retry_after = int(resp.headers.get("Retry-After", 0))
            wait = max(retry_after, _backoff_seconds(attempt))
            logger.warning("Rate limited (429). Waiting %.1fs before retry...", wait)
            time.sleep(wait)
            continue

        if resp.status_code == 401:
            # Token expired — force refresh and retry once
            logger.warning("Unauthorized (401). Refreshing token...")
            token_manager._token = None  # Force refresh
            if attempt < max_retries - 1:
                continue
            resp.raise_for_status()

        if resp.status_code == 403:
            logger.error(
                "Forbidden (403). Check: (1) OAuth scopes include this endpoint, "
                "(2) Practice has granted access, (3) Correct practice ID. "
                "Request ID: %s",
                request_id,
            )
            resp.raise_for_status()

        if resp.status_code >= 400:
            logger.error(
                "API error %d: %s (Request ID: %s)",
                resp.status_code,
                resp.text[:500],
                request_id,
            )
            resp.raise_for_status()

        return resp

    raise RuntimeError(f"Max retries ({max_retries}) exceeded for {method} {url}")


def _backoff_seconds(attempt: int) -> float:
    """Exponential backoff with jitter."""
    import random
    base = min(2 ** attempt, 60)
    return base + random.uniform(0, base * 0.5)


def _backoff(attempt: int) -> None:
    wait = _backoff_seconds(attempt)
    logger.info("Backing off %.1fs...", wait)
    time.sleep(wait)


# ---------------------------------------------------------------------------
# Example: Fetch patient demographics
# ---------------------------------------------------------------------------
def get_patient(patient_id: str) -> dict[str, Any]:
    """Fetch a single patient's demographics."""
    resp = athena_request("GET", f"/patients/{patient_id}")
    return resp.json()[0] if resp.json() else {}


def search_patients(first_name: str, last_name: str, dob: str) -> list[dict[str, Any]]:
    """
    Search for patients by name and DOB.

    IMPORTANT: Always search before creating a new patient.
    Creating duplicates requires costly manual merges.
    """
    resp = athena_request(
        "GET",
        "/patients",
        params={
            "firstname": first_name,
            "lastname": last_name,
            "dob": dob,  # Format: MM/DD/YYYY
        },
    )
    data = resp.json()
    return data.get("patients", [])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Example: Search for a patient
    patients = search_patients("Jane", "Doe", "01/01/1990")
    logger.info("Found %d patient(s)", len(patients))
    for p in patients:
        logger.info("  Patient ID: %s — %s %s", p.get("patientid"), p.get("firstname"), p.get("lastname"))
