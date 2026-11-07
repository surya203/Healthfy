"""Auth HTTP routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app.client_ip import client_ip
from app.cookies import clear_session_cookie, set_session_cookie
from app.database import get_db
from app.schemas import (
    ERROR_RESPONSES,
    LoginRequest,
    RegisterRequest,
    UserEnvelope,
    no_store_headers,
    serialize_user,
)
from app.service import authenticate, register_user, revoke_current_session, user_for_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201, response_model=UserEnvelope, responses=ERROR_RESPONSES)
def register(
    payload: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    settings = request.app.state.settings
    user, token = register_user(db, payload.name, payload.email, payload.password, settings)
    response = JSONResponse(status_code=201, content={"user": serialize_user(user)})
    set_session_cookie(response, token, settings)
    return response


@router.post("/login", response_model=UserEnvelope, responses=ERROR_RESPONSES)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    settings = request.app.state.settings
    user, token = authenticate(
        db,
        payload.email,
        payload.password,
        client_ip(request, trust_x_forwarded_for=settings.trust_x_forwarded_for),
        settings,
    )
    response = JSONResponse(status_code=200, content={"user": serialize_user(user)})
    set_session_cookie(response, token, settings)
    return response


@router.get("/me", response_model=UserEnvelope, responses=ERROR_RESPONSES)
def me(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    settings = request.app.state.settings
    user = user_for_token(db, request.cookies.get(settings.session_cookie_name))
    response = JSONResponse(status_code=200, content={"user": serialize_user(user)})
    for key, value in no_store_headers().items():
        response.headers[key] = value
    return response


@router.post(
    "/logout",
    status_code=204,
    response_class=Response,
    responses={403: ERROR_RESPONSES[403]},
)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    settings = request.app.state.settings
    revoke_current_session(db, request.cookies.get(settings.session_cookie_name))
    response = Response(status_code=204)
    clear_session_cookie(response, settings)
    return response
