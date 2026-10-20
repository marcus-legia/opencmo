"""Thông báo lỗi phải hữu ích nhưng không tiết lộ dữ liệu nội bộ."""

import errno
import subprocess

import httpx
import pytest

from opencmo.media.ffmpeg import FFmpegError
from opencmo.worker.errors import UserMessageError, processing_error


@pytest.mark.parametrize(('exc', 'expected'), [
    (RuntimeError('No video stream found in /secret/x.mp4'), 'read this video'),
    (httpx.ReadTimeout('https://secret.test'), 'connection'),
    (subprocess.TimeoutExpired(['ffmpeg', '/secret'], 30), 'too long'),
    (OSError(errno.ENOSPC, '/secret'), 'storage'),
    (FFmpegError('No space left on device /secret'), 'storage'),
    (FFmpegError('moov atom not found /secret'), 'read this video'),
    (FFmpegError('Unknown encoder SECRET'), 'prepare this video'),
])
def test_classifies_known_failures(exc, expected):
    message = processing_error(exc)
    assert expected in message
    assert 'SECRET' not in message
    assert '/secret' not in message
    assert 'https://' not in message


def test_http_status_is_read_from_response():
    response = httpx.Response(429, request=httpx.Request('GET', 'https://secret.test'))
    assert 'busy' in processing_error(httpx.HTTPStatusError(
        'SECRET', request=response.request, response=response,
    ))


@pytest.mark.parametrize('text', [
    'SECRET private video quota timeout /internal/path',
    'Customer transcript says not enough clear speech',
    'Bearer SECRET https://secret.test',
])
def test_unknown_exceptions_never_pass_through_or_match_loose_keywords(text):
    message = processing_error(RuntimeError(text))
    assert message == (
        'We could not get your video ready to edit. Try again. '
        'If it keeps failing, upload another copy of the video.'
    )


def test_a_message_written_for_the_user_passes_through():
    assert processing_error(UserMessageError('Videos up to 15 minutes can be edited.')) == (
        'Videos up to 15 minutes can be edited.'
    )


def test_stage_fallback_is_bounded():
    assert 'load this video' in processing_error(RuntimeError('SECRET'), 'download')
    assert 'prepare this video' in processing_error(RuntimeError('SECRET'), 'render')
    assert 'SECRET' not in processing_error(RuntimeError('SECRET'), 'SECRET')
