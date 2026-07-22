"""Clerk auth for KBID — verify Clerk session JWTs + enforce the email allowlist.

Pattern copied (not imported) from Profiles/CAS `backend/clerk_auth.py`: Clerk
issues RS256 session tokens signed by the instance JWKS; we verify the signature,
issuer and expiry, then pull `sub`/`email` from the claims. KBID is invitation-only
— every request's email must be on `AUTH_ALLOWLIST`; admins come from `AUTH_ADMINS`.

`jwt` is imported lazily so the app (and the dev-bypass path) boots without PyJWT
installed during early local dev.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from .config import get_settings

settings = get_settings()


class AuthError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


_jwk_client = None  # cached PyJWKClient


def _client():
    global _jwk_client
    url = settings.jwks_url()
    if not url:
        raise AuthError(503, "Clerk auth not configured (set CLERK_PUBLISHABLE_KEY or CLERK_ISSUER).")
    if _jwk_client is None:
        from jwt import PyJWKClient

        _jwk_client = PyJWKClient(url)
    return _jwk_client


def verify_token(authorization: str | None) -> dict:
    """Return {sub, email, claims} for a valid Clerk token; raise AuthError otherwise."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError(401, "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()

    import jwt  # lazy

    issuer = settings.clerk_frontend_api() or None
    try:
        key = _client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False, "require": ["exp", "iat"]},
            leeway=10,
        )
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — surface a clean 401
        raise AuthError(401, f"Invalid token: {str(exc)[:140]}")

    return {
        "sub": claims.get("sub"),
        "email": (claims.get("email") or "").lower() or None,
        "claims": claims,
    }


def _role_for(email: str) -> str:
    return "admin" if email in settings.auth_admins else "member"


async def require_user(request: Request) -> dict:
    """FastAPI dependency: authenticate + authorize the caller.

    Dev bypass (DEV_AUTH_BYPASS=1, non-prod only) returns a fake admin so the UI
    and estimate can be exercised locally without Clerk keys.
    """
    if settings.dev_auth_bypass and not settings.is_prod:
        email = settings.auth_admins[0] if settings.auth_admins else "dev@kbid.local"
        return {"sub": "dev-user", "email": email, "role": "admin", "dev": True}

    try:
        info = verify_token(request.headers.get("authorization"))
    except AuthError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    email = info.get("email")
    if not email:
        raise HTTPException(status_code=403, detail="Token has no email claim.")
    if settings.auth_allowlist and email not in settings.auth_allowlist:
        raise HTTPException(status_code=403, detail="This account is not on the KBID allowlist.")

    info["role"] = _role_for(email)
    return info


async def require_admin(request: Request) -> dict:
    user = await require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only.")
    return user
