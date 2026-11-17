"""Shared names for provisioning Windows clients and distributing account data."""
import re

PUBLIC_HOST = 'music.hbsuzh.cn'
PUBLIC_ORIGIN = 'https://' + PUBLIC_HOST
CREDENTIALS = '/api/server-account/v1/credentials'
ADMIN = '/mineradio-accounts/'
KEY_FILE = 'server-account.key'
KEY_PATTERN = re.compile(r'[A-Za-z0-9_-]{43,128}')
MAX_BODY = 65536
