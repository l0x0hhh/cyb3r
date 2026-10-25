"""Compile a DB-IP Country Lite CSV(.gz) into Nginx CN-only IPv4/IPv6 ranges.

Usage: python scripts/build-mainland-ranges.py source.csv.gz mainland.conf
Get monthly data from https://db-ip.com/db/download/ip-to-country-lite and
verify its publisher checksum before invoking this tool. CC BY 4.0 attribution
is present in the website footer. No visitor IP is sent to a third-party API.
"""
import csv
import gzip
import hashlib
import io
import ipaddress
import json
import sys
from pathlib import Path


def compile_ranges(data):
    rows = []
    counts = {4: 0, 6: 0}
    for first, last, country in csv.reader(io.StringIO(data.decode('utf-8'))):
        if country != 'CN':
            continue
        start, end = ipaddress.ip_address(first), ipaddress.ip_address(last)
        if not start.is_global or not end.is_global:
            raise ValueError('Unexpected non-public country range')
        for network in ipaddress.summarize_address_range(start, end):
            rows.append(f'{network} 1;\n')
            counts[network.version] += 1
    if min(counts.values()) < 100:
        raise ValueError('Country dataset is missing IPv4 or IPv6 coverage')
    header = '# IP Geolocation by DB-IP https://db-ip.com (CC BY 4.0)\n'
    return header + '127.0.0.1/32 1;\n::1/128 1;\n' + ''.join(rows), counts


if __name__ == '__main__':
    source, target = map(Path, sys.argv[1:3])
    raw = source.read_bytes()
    data = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    config, counts = compile_ranges(data)
    target.write_text(config, encoding='utf-8')
    print(json.dumps({'sha256': hashlib.sha256(data).hexdigest(), 'cnCidrs': counts}))
