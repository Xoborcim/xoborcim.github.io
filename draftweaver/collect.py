#!/usr/bin/env python3
"""Collect anonymized Draftweaver snapshots from official Riot APIs. Python 3.10+, no dependencies."""
import argparse
import collections
import itertools
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote, urlsplit
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

REGIONS = {'na1':'americas','br1':'americas','la1':'americas','la2':'americas','euw1':'europe','eun1':'europe','tr1':'europe','ru':'europe','kr':'asia','jp1':'asia','oc1':'sea','ph2':'sea','sg2':'sea','th2':'sea','tw2':'sea','vn2':'sea'}
TIERS = ['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER']
QUEUES = {'solo':(420,'RANKED_SOLO_5x5'),'flex':(440,'RANKED_FLEX_SR'),'clash':(700,None)}
ROLES = {'TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'}
DD = 'https://ddragon.leagueoflegends.com'
# Riot's published rollout date, keyed by the version in Match-V5.
PATCH_ROLLOUTS = {'16.23': date(2026, 11, 18)}

def history_start(args, patch, now):
    since = int(now - args.days * 86400)
    rollout = args.patch_start or PATCH_ROLLOUTS.get(patch)
    if rollout is None:
        return since
    # Begin a day before rollout to allow for differences between regions and UTC.
    cutoff = datetime.combine(rollout - timedelta(days=1), datetime.min.time(), timezone.utc)
    return max(since, int(cutoff.timestamp()))

class NoAuthRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        # Never silently forward an API key or lose the header on a redirected request.
        return None

def riot_open(request,timeout=35):
    return build_opener(NoAuthRedirect()).open(request,timeout=timeout)

def validate_key_input(value):
    key=value.strip()
    if not re.fullmatch(r'RGAPI-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',key):
        raise ValueError(f'Key input has {len(key)} characters and does not match the expected Riot API key format. '
                         'No authenticated request was sent. Paste only the RGAPI key, without quotes, spaces, or console shortcut characters. '
                         'Try right-click paste if Ctrl+V is not handled by the hidden-input prompt.')
    return key

def saved_key_path():
    appdata = os.environ.get('LOCALAPPDATA')
    if os.name != 'nt' or not appdata:
        raise RuntimeError('Saving a Riot key requires a Windows user profile.')
    return Path(appdata) / 'Draftweaver' / 'riot-api-key.dpapi'


def protect_key_bytes(data, *, decrypt=False):
    import ctypes
    from ctypes import wintypes

    class DataBlob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.c_void_p)]

    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    operation = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    operation.argtypes = [ctypes.POINTER(DataBlob)] + [ctypes.c_void_p] * 4 + [wintypes.DWORD, ctypes.POINTER(DataBlob)]
    operation.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    buffer = ctypes.create_string_buffer(data)
    source = DataBlob(len(data), ctypes.addressof(buffer))
    result = DataBlob()
    try:
        # User-scoped encryption, with Windows UI disabled.
        if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
            raise OSError(f'Windows could not access encrypted key storage (error {ctypes.get_last_error()}).')
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.memset(source.data, 0, source.size)
        if result.data:
            ctypes.memset(result.data, 0, result.size)
            kernel32.LocalFree(result.data)


def save_riot_key(key):
    path = saved_key_path()
    encrypted = protect_key_bytes(validate_key_input(key).encode('ascii'))
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
    try:
        temporary.write_bytes(encrypted)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_saved_riot_key():
    if os.name != 'nt' or not os.environ.get('LOCALAPPDATA'):
        return ''
    try:
        encrypted = saved_key_path().read_bytes()
    except FileNotFoundError:
        return ''
    return validate_key_input(protect_key_bytes(encrypted, decrypt=True).decode('ascii'))

# Constant program; credentials and request URLs are supplied exclusively through stdin.
# Uses normal Windows proxy/TLS settings and refuses redirects, just like the Python path.
WINDOWS_HTTP_SCRIPT=r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$client = $null
$handler = $null
$request = $null
$response = $null
try {
    Add-Type -AssemblyName System.Net.Http
    $payload = [Console]::In.ReadLine() | ConvertFrom-Json
    $uri = [Uri]$payload.url
    if ($uri.Scheme -ne 'https' -or -not $uri.Host.EndsWith('.api.riotgames.com')) { throw 'Unsupported request destination' }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(35)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $uri)
    $request.Headers.Add('X-Riot-Token', [string]$payload.key)
    $request.Headers.Accept.ParseAdd('application/json')
    $request.Headers.UserAgent.ParseAdd('Draftweaver/1.3')
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $retrySeconds = '10'
    $retryHeader = $response.Headers.RetryAfter
    if ($retryHeader -and $retryHeader.Delta) {$retrySeconds = [string][Math]::Max(1,[Math]::Ceiling($retryHeader.Delta.TotalSeconds))}
    elseif ($retryHeader -and $retryHeader.Date) {$retrySeconds = [string][Math]::Max(1,[Math]::Ceiling(($retryHeader.Date - [DateTimeOffset]::UtcNow).TotalSeconds))}
    $result = @{status=[int]$response.StatusCode;body=$body;retry_after=$retrySeconds}
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} catch {
    [Console]::Out.WriteLine((@{status=0;error_type=$_.Exception.GetType().Name} | ConvertTo-Json -Compress))
} finally {
    if ($response) {$response.Dispose()}
    if ($request) {$request.Dispose()}
    if ($client) {$client.Dispose()}
    if ($handler) {$handler.Dispose()}
}
'''

def windows_request(url,key):
    if os.name!='nt':
        raise RuntimeError('The Windows HTTP comparison requires Windows.')
    if os.environ.get('CODEX_SANDBOX_NETWORK_DISABLED')=='1':
        raise RuntimeError('Windows HTTP requests cannot run inside this restricted network session.')
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',WINDOWS_HTTP_SCRIPT],
                              input=json.dumps({'url':url,'key':key})+'\n',capture_output=True,text=True,
                              encoding='utf-8',timeout=45,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except (OSError,subprocess.TimeoutExpired):
        raise RuntimeError('Windows HTTP helper could not start or timed out. No credentials were written to disk.') from None
    try:
        data=json.loads(result.stdout.strip().lstrip('\ufeff'))
    except (ValueError,TypeError):
        raise RuntimeError('Windows HTTP helper returned an unexpected result. Raw output is omitted to protect credentials.') from None
    status=data.get('status',0)
    if status==0:
        raise RuntimeError('Windows HTTP helper could not complete the connection; no HTTP response was received.')
    if status!=200:
        raise HTTPError(url,status,'Windows HTTP response',{'Retry-After':data.get('retry_after') or '10'},None)
    return json.loads(data['body'])

def patch_of(version):
    return '.'.join(str(version).split('.')[:2])

def proxy_summary():
    """Describe inherited proxies without exposing passwords or changing settings."""
    result=[]
    for name in ('HTTPS_PROXY','HTTP_PROXY','ALL_PROXY'):
        value=os.environ.get(name) or os.environ.get(name.lower())
        if not value:
            continue
        try:
            parsed=urlsplit(value if '://' in value else '//'+value)
            endpoint=f'{parsed.hostname or "[unrecognized proxy]"}:{parsed.port or "default"}'
        except ValueError:
            endpoint='[unrecognized proxy]'
        result.append(f'{name}={endpoint}')
    return '; '.join(result) or 'No proxy environment variables detected.'

def connection_error(host,service,exc):
    reason=getattr(exc,'reason',exc)
    code=getattr(reason,'winerror',None) or getattr(reason,'errno',None)
    detail=f'{type(reason).__name__}'+(f' (OS code {code})' if code else '')
    return RuntimeError(f'{service} connection failed at {host}: {detail}. '
                        'No HTTP response was received, so this does not establish whether the key is valid. '
                        f'Network settings: {proxy_summary()}')

class RiotAPIError(RuntimeError):
    def __init__(self,status,message):
        super().__init__(message)
        self.status=status

def payload_summary(value,depth=0):
    """Print schema names and types only, never response values or player identifiers."""
    if isinstance(value,dict):
        fields=[]
        for key,item in list(value.items())[:10]:
            label=key if isinstance(key,str) and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,48}',key) else '[non-schema-key]'
            detail=payload_summary(item,depth+1) if depth<1 and isinstance(item,dict) else type(item).__name__
            fields.append(f'{label}:{detail}')
        return 'object {'+', '.join(fields)+(' ...' if len(value)>10 else '')+'}'
    if isinstance(value,list):
        return f'list ({len(value)} items)'
    return type(value).__name__

def checked_payload(value,service,host):
    # Some intermediaries may preserve Riot's JSON error body but change HTTP status.
    status=value.get('status') if isinstance(value,dict) else None
    code=status.get('status_code') if isinstance(status,dict) else None
    if isinstance(code,int) and code>=400:
        raise RiotAPIError(code,f'{service} at {host}.api.riotgames.com returned a JSON error status {code}. No response values are logged.')
    return value

class RiotClient:
    def __init__(self, key, interval=1.3, attempts=3,http_client='urllib'):
        self.key, self.interval, self.last = key, interval, 0.0
        self.attempts=attempts
        self.http_client=http_client
        self.stop=None

    def for_route(self, stop):
        client=RiotClient(self.key, self.interval, self.attempts, self.http_client)
        client.stop=stop
        return client

    def wait(self, seconds):
        if self.stop is None:
            time.sleep(seconds)
        elif self.stop.wait(seconds):
            raise InterruptedError('Collection was stopped.')

    def get(self, host, path, params=None, missing_ok=False):
        url = f'https://{host}.api.riotgames.com{path}'
        if params:
            url += '?' + urlencode(params)
        service='Match-V5' if '/match/v5/' in path else 'League-V4' if '/league/v4/' in path else 'Champion-V3' if '/platform/v3/champion-rotations' in path else 'Riot API'
        for attempt in range(self.attempts):
            self.wait(max(0, self.last + self.interval - time.monotonic()))
            self.last = time.monotonic()
            try:
                if self.http_client=='windows':
                    return checked_payload(windows_request(url,self.key),service,host)
                with riot_open(Request(url, headers={'X-Riot-Token': self.key,'Accept':'application/json','User-Agent':'Draftweaver/1.3'}), timeout=35) as response:
                    return checked_payload(json.load(response),service,host)
            except HTTPError as exc:
                if exc.code == 404 and missing_ok:
                    return None
                if exc.code == 401:
                    raise RiotAPIError(401,f'{service} at {host}.api.riotgames.com returned HTTP 401: authentication missing or invalid.') from None
                if exc.code == 403:
                    raise RiotAPIError(403,f'{service} at {host}.api.riotgames.com returned HTTP 403: key expired/invalid, endpoint access denied, or unsupported route. This is an HTTP response from the API, not a connection-refused error.') from None
                if 300<=exc.code<400:
                    raise RiotAPIError(exc.code,f'{service} returned an HTTP {exc.code} redirect. The request was stopped so its key would not be forwarded or silently dropped.') from None
                if exc.code == 429:
                    if attempt == self.attempts - 1:
                        raise RiotAPIError(429, f'{service} at {host}.api.riotgames.com is rate limiting requests. Resume later from the saved cache.') from None
                    try:
                        delay=max(2,float(exc.headers.get('Retry-After','10')))
                    except (ValueError,TypeError):
                        delay=10
                elif exc.code >= 500:
                    delay = min(60, 2 ** (attempt + 1))
                else:
                    raise RuntimeError(f'{service} at {host}.api.riotgames.com returned HTTP {exc.code}. Check region, request parameters and API access.') from None
                if attempt < self.attempts-1:
                    print(f'{service} HTTP {exc.code}; waiting {delay:.0f}s.', file=sys.stderr,flush=True)
                    self.wait(delay)
            except (URLError, TimeoutError,ConnectionError) as exc:
                # Refused connections and proxy failures are not fixed by retrying a key.
                raise connection_error(f'{host}.api.riotgames.com',service,exc) from None
        raise RuntimeError(f'{service} at {host}.api.riotgames.com exhausted {self.attempts} HTTP retries. Cached progress is preserved.')

def public_json(url):
    host=urlsplit(url).hostname
    try:
        with urlopen(Request(url, headers={'User-Agent':'Draftweaver/1.1'}), timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'Data Dragon at {host} returned HTTP {exc.code}. This public request does not use your API key.') from None
    except (URLError,TimeoutError,ConnectionError) as exc:
        raise connection_error(host,'Data Dragon (no key required)',exc) from None

def load_catalog():
    print('Step 1: checking public Data Dragon versions (no API key sent)...',flush=True)
    versions=public_json(f'{DD}/api/versions.json')
    if not isinstance(versions,list) or not versions or not isinstance(versions[0],str):
        raise RuntimeError('Data Dragon returned an unexpected versions payload.')
    version=versions[0]
    print(f'  OK: asset version {version}. Fetching champion catalog...',flush=True)
    body=public_json(f'{DD}/cdn/{version}/data/en_US/champion.json')
    if not isinstance(body,dict) or not isinstance(body.get('data'),dict) or not body['data']:
        raise RuntimeError('Data Dragon returned an unexpected champion catalog.')
    champion_ids={str(c['key']):c['id'] for c in body['data'].values()}
    print(f'  OK: {len(champion_ids)} champions loaded.',flush=True)
    return version,champion_ids

def normalize_match(raw, region, cohort, champion_ids, patch=None, queue=None):
    """Drop incomplete/remake/unknown-role matches. Never infer roles or lobby ranks."""
    info = raw.get('info', {})
    queue_name = next((name for name, (qid, _) in QUEUES.items() if qid == info.get('queueId')), None)
    actual_patch = patch_of(info.get('gameVersion',''))
    if not queue_name or (patch and actual_patch != patch) or (queue and queue_name != queue):
        return None
    duration = info.get('gameDuration',0)
    if duration <= 300:
        return None
    participants = info.get('participants',[])
    if len(participants) != 10 or any(p.get('gameEndedInEarlySurrender') for p in participants):
        return None
    players = []
    for p in participants:
        role = p.get('teamPosition')
        champion = champion_ids.get(str(p.get('championId')))
        if role not in ROLES or not champion or not isinstance(p.get('win'), bool):
            return None
        players.append({'champion':champion,'team':p.get('teamId'),'role':role,'win':p['win']})
    if len({p['champion'] for p in players}) != 10:
        return None
    for team in (100,200):
        team_players = [p for p in players if p['team']==team]
        if len(team_players)!=5 or {p['role'] for p in team_players}!=ROLES:
            return None
        if len({p['win'] for p in team_players})!=1:
            return None
    if players[0]['win'] == next(p['win'] for p in players if p['team']!=players[0]['team']):
        return None
    banned = []
    picked = {p['champion'] for p in players}
    for team in info.get('teams',[]):
        for ban in team.get('bans',[]):
            cid = ban.get('championId',-1)
            if cid == -1:
                continue
            champion = champion_ids.get(str(cid))
            if not champion or champion in picked:
                return None
            banned.append(champion)
    if len(banned)>10:
        return None
    match_id = raw.get('metadata',{}).get('matchId')
    timestamp = info.get('gameStartTimestamp', info.get('gameCreation',0))
    if not match_id or not timestamp:
        return None
    # Internal Riot match IDs are used only for local deduplication, not exported.
    import hashlib
    anonymous_id = hashlib.sha256(match_id.encode()).hexdigest()[:24]
    return {'id':anonymous_id,'patch':actual_patch,'region':region,'cohort':cohort,'queue':queue_name,'timestamp':timestamp,'players':players,'bans':sorted(set(banned))}

def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--regions', nargs='+', default=['na1'])
    p.add_argument('--tiers', nargs='+', default=['EMERALD','DIAMOND','MASTER'])
    p.add_argument('--queues', nargs='+', default=['solo'])
    p.add_argument('--patch', help='Major.minor patch. Defaults to latest Data Dragon patch.')
    p.add_argument('--players', type=int, default=10, help='Maximum seed players per region / seed tier / ladder queue.')
    p.add_argument('--pages', type=int, default=1, help='League entry pages per non-apex tier (each division).')
    p.add_argument('--matches-per-player', type=int, default=20)
    p.add_argument('--max-matches', type=int, default=1000, help='Total export cap, divided across requested cohorts.')
    p.add_argument('--days', type=int, default=14, help='Look back this many days, still filtering to the selected patch.')
    p.add_argument('--patch-start', type=date.fromisoformat, help='Patch rollout date (YYYY-MM-DD). Searches start a day earlier to allow for regional rollout times.')
    p.add_argument('--seeds', type=Path, help='Optional JSON array: [{"puuid":"...","region":"na1","cohort":"UNKNOWN"}].')
    p.add_argument('--output', type=Path, default=Path('data.json'))
    p.add_argument('--cache', type=Path, default=Path('.cache/rift-draft.sqlite3'))
    p.add_argument('--watch-minutes', type=float, default=0, help='Repeat collection at this interval while running.')
    p.add_argument('--diagnose', action='store_true', help='Check public catalog, authenticated ladder access, match IDs and match details without collecting a dataset.')
    p.add_argument('--http-client',choices=['urllib','windows'],default='urllib',help='HTTP implementation for authenticated Riot requests.')
    p.add_argument('--compare-clients',action='store_true',help='During diagnosis, compare the same key using Windows HTTP if Python gets 401/403.')
    p.add_argument('--resume',action='store_true',help='Keep eligible previously collected matches and resume seed discovery from the local cache.')
    p.add_argument('--parallel-regions', action='store_true', help='With --resume, collect from distinct Match-V5 routes concurrently, each with its own request pacing.')
    p.add_argument('--checkpoint-every',type=int,default=250,help='Publish an atomic dataset snapshot after this many new matches and at each cohort boundary.')
    p.add_argument('--revisit-hours',type=float,default=6,help='With --resume, skip seed histories fully checked within this many hours.')
    p.add_argument('--save-key',action='store_true',help='Prompt privately and save the key encrypted for the current Windows user.')
    args = p.parse_args(argv)
    if args.parallel_regions and not args.resume:
        p.error('--parallel-regions requires --resume.')
    for name, allowed in [('regions',list(REGIONS)),('tiers',TIERS),('queues',list(QUEUES))]:
        values = getattr(args,name)
        if name=='tiers':
            values=[v.upper() for v in values]
        if any(v.lower()=='all' for v in values):
            values=allowed
        if not values or any(v not in allowed for v in values):
            p.error(f'Invalid --{name}. Choose from {", ".join(allowed)} or all.')
        setattr(args,name,list(dict.fromkeys(values)))
    if any(getattr(args,x)<1 for x in ['players','pages','matches_per_player','max_matches','days','checkpoint_every']) or args.matches_per_player>100:
        p.error('Counts must be positive; --matches-per-player must be at most 100.')
    if args.watch_minutes and args.watch_minutes<1:
        p.error('--watch-minutes must be at least 1, or 0 to run once.')
    if args.revisit_hours<0:
        p.error('--revisit-hours must be at least 0.')
    if args.max_matches>50000:
        p.error('--max-matches must be at most 50000 for the browser dataset. Keep larger raw collections in the local cache.')
    if args.patch and (len(args.patch.split('.'))!=2 or not all(s.isdigit() for s in args.patch.split('.'))):
        p.error('--patch must be major.minor, for example 16.23.')
    return args

def league_seeds(client,region,tier,queue,args,rng):
    ladder=QUEUES[queue][1]
    if not ladder:
        return []
    entries=[]
    if tier in ('MASTER','GRANDMASTER','CHALLENGER'):
        body=client.get(region,f'/lol/league/v4/{tier.lower()}leagues/by-queue/{ladder}')
        if not isinstance(body,dict) or not isinstance(body.get('entries',[]),list) or any(not isinstance(item,dict) for item in body.get('entries',[])):
            raise RuntimeError(f'League-V4 expected an apex league object with entries; received {payload_summary(body)}. No player values are logged.')
        entries=body.get('entries',[])
    else:
        for division in ('I','II','III','IV'):
            for page in range(1,args.pages+1):
                body=client.get(region,f'/lol/league/v4/entries/{ladder}/{tier}/{division}',{'page':page})
                if not isinstance(body,list) or any(not isinstance(item,dict) for item in body):
                    raise RuntimeError(f'League-V4 expected a list of entries; received {payload_summary(body)}. No player values are logged.')
                if not body:
                    break
                entries.extend(body)
    rng.shuffle(entries)
    seeds=[]
    seen=set()
    for e in entries:
        if len(seeds)>=args.players:
            break
        puuid=e.get('puuid')
        if puuid and puuid not in seen:
            seen.add(puuid)
            seeds.append({'puuid':puuid,'region':region,'cohort':tier})
    if entries and not seeds:
        raise RuntimeError(f'League-V4 returned entries without PUUIDs for {region}/{tier}/{queue}. The collector requires modern puuid fields; it will not use a summoner-ID fallback.')
    return seeds

def diagnose(args,client,catalog):
    region,tier,queue=args.regions[0],args.tiers[0],args.queues[0]
    print(f'Step 2: basic authenticated Champion-V3 request to {region}.api.riotgames.com...',flush=True)
    print(f'  GET /lol/platform/v3/champion-rotations (key in header only; client={client.http_client})',flush=True)
    try:
        rotation=client.get(region,'/lol/platform/v3/champion-rotations')
    except RiotAPIError as exc:
        if exc.status in (401,403):
            if args.compare_clients and client.http_client=='urllib' and os.name=='nt':
                print(f'  Python received HTTP {exc.status}. Comparing the identical key and endpoint with Windows HTTP...',flush=True)
                comparison=RiotClient(client.key,http_client='windows',attempts=1)
                try:
                    rotation=comparison.get(region,'/lol/platform/v3/champion-rotations')
                except RiotAPIError as other:
                    raise RuntimeError(f'Python received HTTP {exc.status}; Windows HTTP received HTTP {other.status} for the same key and {region} request. '
                                       'The result is not specific to Python. Compare the same key in the Riot tester; no collection was attempted.') from None
                client.http_client='windows'
                print('  Windows HTTP succeeded. Continuing the diagnostic with Windows HTTP. Use QUICK-START-WINDOWS.cmd for collection.',flush=True)
            else:
                raise RuntimeError(f'Basic authenticated access was denied (HTTP {exc.status}) before ladder access was tested. '
                                   'If the same key works on NA1 in Riot\'s tester, run DIAGNOSE.cmd v1.3 for the Windows HTTP comparison. '
                                   'This result alone does not establish the exact cause of denial.') from None
        else:
            raise
    # Rotations are an optional connectivity probe, never an input to statistics.
    # Riot omits empty fields; casing/schema differences here must not block Match-V5.
    known={'freechampionids','freechampionidsfornewplayers','maxnewplayerlevel'}
    recognized=isinstance(rotation,dict) and any(str(k).lower() in known for k in rotation)
    print(f'  Champion-V3 JSON shape: {payload_summary(rotation)}',flush=True)
    if recognized:
        print('  OK: champion-rotation response received. Checking the endpoints needed for statistics next.',flush=True)
    else:
        print('  Note: rotation schema is unrecognized. This optional data is not used by the collector; testing ladder access directly.',flush=True)
    print(f'Step 3: authenticated League-V4 request to {region}.api.riotgames.com...',flush=True)
    probe=argparse.Namespace(players=3,pages=1)
    try:
        seeds=league_seeds(client,region,tier,'solo' if queue=='clash' else queue,probe,random.Random(0))
    except RiotAPIError as exc:
        if exc.status in (401,403):
            raise RuntimeError(f'Champion-V3 returned JSON, but League-V4 ladder access was denied (HTTP {exc.status}). '
                               f'Test League-V4 / getLeagueEntries for {region}, {tier}, division I in the Riot portal. '
                               'This indicates a ladder request/access issue; it does not mean the key fails every endpoint.') from None
        raise
    print(f'  OK: ladder request returned HTTP 200; {len(seeds)} usable seed players. Key accepted for League-V4.',flush=True)
    if not seeds:
        raise RuntimeError('The ladder is empty for this cohort. Try another seed tier or queue; no match endpoints have been tested yet.')
    print(f'Step 4: checking Match-V5 IDs on {REGIONS[region]}.api.riotgames.com...',flush=True)
    for seed in seeds:
        ids=client.get(REGIONS[region],f'/lol/match/v5/matches/by-puuid/{quote(seed["puuid"],safe="")}/ids',{'queue':QUEUES[queue][0],'start':0,'count':5})
        if not isinstance(ids,list):
            raise RuntimeError('Match-V5 returned an unexpected match-list payload.')
        if not ids:
            continue
        print(f'  OK: match-list request returned HTTP 200 and {len(ids)} IDs.',flush=True)
        print('Step 5: fetching one match detail response...',flush=True)
        raw=client.get(REGIONS[region],f'/lol/match/v5/matches/{quote(ids[0],safe="")}')
        if not isinstance(raw,dict) or not isinstance(raw.get('info'),dict):
            raise RuntimeError('Match-V5 returned unexpected match details.')
        observed=patch_of(raw['info'].get('gameVersion',''))
        version,champion_ids=catalog
        normalized=normalize_match(raw,region,tier,champion_ids)
        print(f'  OK: match details received; game patch {observed}; asset patch {patch_of(version)}.',flush=True)
        if not normalized:
            print('  Note: this particular game is excluded by role/remake validation. API access itself succeeded.',flush=True)
        print('PASS: public data, authentication, ladder discovery, match IDs and match details are reachable. No dataset or key was saved.',flush=True)
        return
    raise RuntimeError(f'Match-V5 accepted the requests but these seeds have no {queue} history. No match detail response was tested. Try --queues solo or more seeds.')

def collect(args,client,catalog=None):
    version,champion_ids=catalog or load_catalog()
    patch=args.patch or patch_of(version)
    args.cache.parent.mkdir(parents=True, exist_ok=True)
    connection=sqlite3.connect(args.cache)
    connection.execute('CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    extra_seeds=[]
    if args.seeds:
        extra_seeds=json.loads(args.seeds.read_text(encoding='utf-8-sig'))
        if not isinstance(extra_seeds,list) or any(not isinstance(s,dict) or not isinstance(s.get('puuid'),str) or s.get('region') not in REGIONS or not isinstance(s.get('cohort','UNKNOWN'),str) for s in extra_seeds):
            raise ValueError('Invalid seeds file. Expected puuid, region and optional string cohort.')
    rng=random.Random(f'{patch}-{datetime.now(timezone.utc).date()}')
    cohorts=list(itertools.product(args.regions,args.tiers,args.queues))
    rng.shuffle(cohorts)
    if args.max_matches<len(cohorts):
        print(f'Warning: {len(cohorts)} cohort combinations exceed the {args.max_matches} match budget. Increase --max-matches for coverage.', file=sys.stderr)
    per_cohort=max(1,math.ceil(args.max_matches/len(cohorts)))
    seed_cache={}
    exported={}
    since=history_start(args,patch,time.time())
    try:
        for region,tier,queue in cohorts:
            if len(exported)>=args.max_matches:
                break
            # Clash has no tier ladder. Reuse solo seeds only as discovery candidates;
            # only actual queue-700 matches are accepted and no lobby rank is inferred.
            seed_queue='solo' if queue=='clash' else queue
            sk=(region,tier,seed_queue)
            if sk not in seed_cache:
                print(f'Checking League-V4: {region} / {tier} / {seed_queue}...',flush=True)
                seed_cache[sk]=league_seeds(client,region,tier,seed_queue,args,rng)
            seeds=seed_cache[sk]+[dict(s,cohort=s.get('cohort','UNKNOWN')) for s in extra_seeds if s['region']==region and (s.get('cohort','UNKNOWN')==tier or (tier==args.tiers[0] and s.get('cohort','UNKNOWN')=='UNKNOWN'))]
            found=0
            print(f'  {len(seeds)} seed players; discovering {queue} matches on {REGIONS[region]}.api.riotgames.com...',flush=True)
            if not seeds:
                print('  No seed players in this cohort. Continuing to the next cohort.',flush=True)
            rejected=collections.Counter()
            for seed in seeds:
                if found>=per_cohort or len(exported)>=args.max_matches:
                    break
                ids=client.get(REGIONS[region],f'/lol/match/v5/matches/by-puuid/{quote(seed["puuid"],safe="")}/ids',{'queue':QUEUES[queue][0],'startTime':since,'start':0,'count':args.matches_per_player},missing_ok=True) or []
                for mid in ids:
                    if found>=per_cohort or len(exported)>=args.max_matches:
                        break
                    cached=connection.execute('SELECT body FROM matches WHERE id=?',(mid,)).fetchone()
                    if cached:
                        raw=json.loads(cached[0])
                    else:
                        raw=client.get(REGIONS[region],f'/lol/match/v5/matches/{quote(mid,safe="")}',missing_ok=True)
                        if not raw:
                            continue
                        connection.execute('INSERT OR REPLACE INTO matches VALUES (?,?)',(mid,json.dumps(raw,separators=(',',':'))))
                        connection.commit()
                    m=normalize_match(raw,region,seed['cohort'],champion_ids,patch,queue)
                    if not m:
                        rejected['other patch' if patch_of(raw.get('info',{}).get('gameVersion',''))!=patch else 'remake / incomplete roles / unsupported match']+=1
                    if m and m['id'] not in exported:
                        exported[m['id']]=m
                        found+=1
                        if len(exported)%10==0:
                            print(f'  Progress: {len(exported)} valid patch-{patch} matches ready.',flush=True)
            print(f'{region} / {tier} seed cohort / {queue}: {found} matches, {len(exported)} total.',flush=True)
            if rejected:
                print(f'  Exclusions: {dict(rejected)}',flush=True)
    finally:
        connection.close()
    if not exported:
        raise RuntimeError('No eligible matches found. Output was not overwritten. Try more seeds, --days, or another patch. Unknown roles and remakes are excluded.')
    meta={'kind':'riot','source':'Riot Match-V5 · sampled ladder seeds','generatedAt':datetime.now(timezone.utc).isoformat(),'assetVersion':version,'cohortMethod':'Seed rank at collection time, not verified lobby rank. Ladder pages are sampled across divisions; up to a per-cohort match quota. Matches deduplicated globally; seed cohort assigned to first discovering seed. Mixed-rank lobbies and selection bias remain. Invalid roles, remakes and other patches excluded.','requestedRegions':args.regions,'requestedTiers':args.tiers,'requestedQueues':args.queues}
    snapshot={'schemaVersion':1,'meta':meta,'matches':list(exported.values())}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_suffix(args.output.suffix+'.tmp')
    temporary.write_text(json.dumps(snapshot,separators=(',',':')),encoding='utf-8')
    temporary.replace(args.output)
    counts=collections.Counter(m['queue'] for m in exported.values())
    print(f'Saved {len(exported)} matches for patch {patch} to {args.output}. Queues: {dict(counts)}',flush=True)
    for queue in args.queues:
        if not counts[queue]:
            print(f'No {queue} data found. That queue will remain unavailable; no fallback statistics were substituted.',file=sys.stderr)

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,separators=(',',':')),encoding='utf-8')
    for attempt in range(5):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt==4:
                raise
            time.sleep(0.2*(2**attempt))

def valid_sample(m):
    if not isinstance(m,dict) or not isinstance(m.get('id'),str) or not re.fullmatch(r'[0-9a-f]{24}',m['id']):
        return False
    if not isinstance(m.get('patch'),str) or not re.fullmatch(r'\d+\.\d+',m['patch']) or m.get('region') not in REGIONS or m.get('queue') not in QUEUES or not isinstance(m.get('cohort'),str):
        return False
    if type(m.get('timestamp')) not in (int,float) or not math.isfinite(m['timestamp']) or m['timestamp']<=0:
        return False
    players=m.get('players');bans=m.get('bans')
    if not isinstance(players,list) or len(players)!=10 or not isinstance(bans,list) or len(bans)>10 or any(not isinstance(x,str) for x in bans):
        return False
    if any(not isinstance(p,dict) or not isinstance(p.get('champion'),str) or not p['champion'] or type(p.get('win')) is not bool or p.get('role') not in ROLES or p.get('team') not in (100,200) for p in players):
        return False
    champions={p['champion'] for p in players}
    if len(champions)!=10 or champions.intersection(bans):
        return False
    for team in (100,200):
        ps=[p for p in players if p['team']==team]
        if len(ps)!=5 or {p['role'] for p in ps}!=ROLES or len({p['win'] for p in ps})!=1:
            return False
    return players[0]['win']!=next(p['win'] for p in players if p['team']!=players[0]['team'])

def collect_resumable(args,client,catalog=None):
    version,champion_ids=catalog or load_catalog()
    patch=args.patch or patch_of(version)
    args.cache.parent.mkdir(parents=True,exist_ok=True)
    connection=sqlite3.connect(args.cache, check_same_thread=False)
    connection.execute('CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, patch TEXT NOT NULL, region TEXT NOT NULL, cohort TEXT NOT NULL, queue TEXT NOT NULL, body TEXT NOT NULL)')
    connection.execute('CREATE INDEX IF NOT EXISTS sample_filters ON samples(patch,region,cohort,queue)')
    connection.execute('CREATE TABLE IF NOT EXISTS seed_visits (patch TEXT, region TEXT, cohort TEXT, queue TEXT, seed_hash TEXT, checked_at REAL, PRIMARY KEY(patch,region,cohort,queue,seed_hash))')
    connection.commit()
    exported={};cohort_counts=collections.Counter();new_count=0;state='interrupted'
    cohorts=list(itertools.product(args.regions,args.tiers,args.queues))
    per_cohort=max(1,math.ceil(args.max_matches/len(cohorts)))
    rng=random.Random(f'{patch}-{datetime.now(timezone.utc).date()}')
    rng.shuffle(cohorts)
    eligible=lambda m:m['patch']==patch and m['region'] in args.regions and m['cohort'] in args.tiers and m['queue'] in args.queues

    lock = threading.RLock()
    stop = threading.Event()

    def cached_row(query, params):
        with lock:
            return connection.execute(query, params).fetchone()

    def add_sample(m):
        if m['id'] in exported or not eligible(m) or len(exported)>=args.max_matches:
            return False
        exported[m['id']]=m
        cohort_counts[(m['region'],m['cohort'],m['queue'])]+=1
        return True

    def checkpoint():
        if not exported:
            return
        coverage=[{'region':region,'cohort':tier,'queue':queue,'matches':cohort_counts[(region,tier,queue)]} for region,tier,queue in itertools.product(args.regions,args.tiers,args.queues)]
        rank_counts={tier:sum(row['matches'] for row in coverage if row['cohort']==tier) for tier in args.tiers}
        generated=datetime.now(timezone.utc).isoformat()
        progress={'state':state,'target':args.max_matches,'matches':len(exported),'targetReached':len(exported)>=args.max_matches,'rankCounts':rank_counts,'perCohortTarget':per_cohort}
        meta={'kind':'riot','source':'Riot Match-V5 · all requested ladder seed cohorts','generatedAt':generated,'assetVersion':version,'requestedRegions':args.regions,'requestedTiers':args.tiers,'requestedQueues':args.queues,'coverage':coverage,'collection':progress,'cohortMethod':'Seed rank at discovery time, not verified lobby rank. Requested region/rank/queue cohorts have per-cohort quotas; actual counts and gaps are reported. Ladder pages and seed players are bounded samples, not a representative census. Matches deduplicated globally; first discovering seed determines the cohort. Remakes, invalid roles and other patches excluded.'}
        atomic_json(args.output,{'schemaVersion':1,'meta':meta,'matches':list(exported.values())})
        atomic_json(args.output.with_name(args.output.stem+'.status.json'),{'schemaVersion':1,'generatedAt':generated,'patch':patch,**progress})

    def collect_cohorts(route_cohorts, route_client, route, extra_seeds):
        nonlocal new_count
        seed_cache = {}
        since = history_start(args, patch, time.time())
        route_rng = rng if route == 'sequential' else random.Random(f'{patch}-{datetime.now(timezone.utc).date()}-{route}')

        def done(group):
            with lock:
                return stop.is_set() or len(exported) >= args.max_matches or cohort_counts[group] >= per_cohort

        def fetch(host, path, params=None, **kwargs):
            if stop.is_set():
                raise InterruptedError('Collection was stopped.')
            return route_client.get(host, path, params, **kwargs)
        for region,tier,queue in route_cohorts:
            group=(region,tier,queue)
            if stop.is_set():
                break
            if done(group):
                continue
            print(f'Checking {region} / {tier} / {queue}: {cohort_counts[group]:,}/{per_cohort:,} saved...',flush=True)
            seed_queue='solo' if queue=='clash' else queue
            sk=(region,tier,seed_queue)
            if sk not in seed_cache:
                seed_cache[sk]=league_seeds(route_client,region,tier,seed_queue,args,route_rng)
            seeds=seed_cache[sk]+[s for s in extra_seeds if s['region']==region and s.get('cohort','UNKNOWN')==tier]
            skipped=0;rejected=collections.Counter()
            for seed in seeds:
                if done(group):
                    break
                seed_hash=hashlib.sha256(seed['puuid'].encode()).hexdigest()
                visit=cached_row('SELECT checked_at FROM seed_visits WHERE patch=? AND region=? AND cohort=? AND queue=? AND seed_hash=?',(patch,region,tier,queue,seed_hash))
                if visit and time.time()-visit[0]<args.revisit_hours*3600:
                    skipped+=1
                    continue
                ids=fetch(REGIONS[region],f'/lol/match/v5/matches/by-puuid/{quote(seed["puuid"],safe="")}/ids',{'queue':QUEUES[queue][0],'startTime':since,'start':0,'count':args.matches_per_player},missing_ok=True) or []
                if not isinstance(ids,list) or any(not isinstance(mid,str) for mid in ids):
                    raise RuntimeError(f'Match-V5 returned an unexpected ID list: {payload_summary(ids)}')
                completed_seed=True
                for mid in dict.fromkeys(ids):
                    if done(group):
                        completed_seed=False
                        break
                    # Match IDs encode their platform. A transferred player may have
                    # games from another platform in the same regional history.
                    if mid.split('_', 1)[0].lower() != region:
                        continue
                    anonymous_id = hashlib.sha256(mid.encode()).hexdigest()[:24]
                    with lock:
                        if anonymous_id in exported:
                            continue
                        previous = cached_row('SELECT body FROM samples WHERE id=?', (anonymous_id,))
                        if previous:
                            canonical = json.loads(previous[0])
                            if valid_sample(canonical):
                                add_sample(canonical)
                            continue
                        cached = cached_row('SELECT body FROM matches WHERE id=?', (mid,))
                    raw = json.loads(cached[0]) if cached else fetch(
                        REGIONS[region], f'/lol/match/v5/matches/{quote(mid,safe="")}', missing_ok=True
                    )
                    if not raw:
                        continue
                    sample = normalize_match(raw, region, tier, champion_ids, patch, queue)
                    with lock:
                        with connection:
                            if not cached:
                                connection.execute('INSERT OR IGNORE INTO matches VALUES (?,?)', (mid, json.dumps(raw,separators=(',',':'))))
                            if sample:
                                connection.execute('INSERT OR IGNORE INTO samples VALUES (?,?,?,?,?,?)',
                                                   (sample['id'], sample['patch'], sample['region'], sample['cohort'], sample['queue'], json.dumps(sample,separators=(',',':'))))
                        if sample and add_sample(sample):
                            new_count += 1
                            if new_count % 25 == 0:
                                print(f'  {len(exported):,}/{args.max_matches:,} matches ? {region}/{tier}/{queue}: {cohort_counts[group]:,}',flush=True)
                            if new_count % args.checkpoint_every == 0:
                                checkpoint()
                    if not sample:
                        wrong_patch = patch_of(raw.get('info',{}).get('gameVersion','')) != patch
                        rejected['other patch' if wrong_patch else 'remake / unknown roles / invalid match'] += 1
                if completed_seed:
                    with lock, connection:
                        connection.execute('INSERT OR REPLACE INTO seed_visits VALUES (?,?,?,?,?,?)',
                                           (patch, region, tier, queue, seed_hash, time.time()))
            with lock:
                checkpoint()
                print(f'  Saved {cohort_counts[group]:,} in {region}/{tier}/{queue}; {len(exported):,} total. Recently checked seeds skipped: {skipped}.',flush=True)
            if rejected:
                print(f'  Exclusions: {dict(rejected)}',flush=True)

    try:
        # Migrate the previous successful snapshot so the first small collection is retained.
        if args.output.exists():
            try:
                prior=json.loads(args.output.read_text(encoding='utf-8-sig'))
                if prior.get('schemaVersion')==1 and prior.get('meta',{}).get('kind')=='riot':
                    for m in prior.get('matches',[]):
                        if valid_sample(m):
                            connection.execute('INSERT OR IGNORE INTO samples VALUES (?,?,?,?,?,?)',(m['id'],m['patch'],m['region'],m['cohort'],m['queue'],json.dumps(m,separators=(',',':'))))
                connection.commit()
            except (ValueError,AttributeError):
                raise RuntimeError('The existing output is not a valid dataset. Preserve it and select another --output path.') from None
        rows=connection.execute('SELECT body FROM samples WHERE patch=? ORDER BY id',(patch,))
        for (body,) in rows:
            m=json.loads(body)
            if valid_sample(m):
                add_sample(m)
        state='collecting'
        checkpoint()
        print(f'Resuming patch {patch}: {len(exported):,} eligible matches already saved; target {args.max_matches:,}.',flush=True)
        since = history_start(args, patch, time.time())
        print(f'Match histories start at {datetime.fromtimestamp(since, timezone.utc):%Y-%m-%d %H:%M UTC}.', flush=True)
        print(f'{len(cohorts)} requested region / seed rank / queue groups; target about {per_cohort:,} matches per group.',flush=True)
        extra_seeds=[]
        if args.seeds:
            extra_seeds=json.loads(args.seeds.read_text(encoding='utf-8-sig'))
            if not isinstance(extra_seeds,list) or any(not isinstance(s,dict) or not isinstance(s.get('puuid'),str) or s.get('region') not in REGIONS or not isinstance(s.get('cohort','UNKNOWN'),str) for s in extra_seeds):
                raise ValueError('Invalid seeds file.')
        if args.parallel_regions:
            by_route = collections.defaultdict(list)
            for group in cohorts:
                by_route[REGIONS[group[0]]].append(group)
            print(f'Collecting concurrently across {len(by_route)} Riot Match-V5 routes.', flush=True)
            with ThreadPoolExecutor(max_workers=len(by_route)) as executor:
                futures = [
                    executor.submit(collect_cohorts, groups, client.for_route(stop), route, extra_seeds)
                    for route, groups in by_route.items()
                ]
                try:
                    for future in as_completed(futures):
                        future.result()
                finally:
                    stop.set()
        else:
            collect_cohorts(cohorts, client, 'sequential', extra_seeds)
        state='finished'
    finally:
        if state=='collecting':
            state='interrupted'
        try:
            checkpoint()
        finally:
            connection.close()
    if not exported:
        raise RuntimeError('No eligible current-patch matches found. Existing output was not overwritten.')
    print(f'Saved {len(exported):,}/{args.max_matches:,} requested matches. New this run: {new_count:,}.',flush=True)
    print('Seed-rank coverage: '+', '.join(f'{tier}={sum(count for (_,t,_),count in cohort_counts.items() if t==tier):,}' for tier in args.tiers),flush=True)
    if len(exported)<args.max_matches:
        print('Target not reached within these seed/page limits. Rerun to resume, increase --players/--pages, or allow new games to accumulate.',flush=True)

def main(argv=None):
    args=parse_args(argv)
    if args.save_key:
        import getpass
        if not sys.stdin.isatty():
            print('Open SAVE-RIOT-KEY.cmd in File Explorer to enter the key privately.',file=sys.stderr)
            return 2
        try:
            save_riot_key(getpass.getpass('Riot API key (hidden): '))
        except (KeyboardInterrupt, EOFError):
            return 130
        except (OSError, ValueError, RuntimeError) as exc:
            print(f'Could not save the Riot key: {exc}',file=sys.stderr)
            return 1
        print('Riot key saved with Windows encryption. Future collection runs will load it automatically.')
        return 0
    if os.environ.get('CODEX_SANDBOX_NETWORK_DISABLED')=='1':
        print('This terminal inherited a restricted network session and cannot reach Riot.\n'
              'Close this window. Open File Explorer yourself and double-click COLLECT.cmd\n'
              'in the Draftweaver folder. Do not launch the collector from this chat.\n'
              'Your API key has not been checked or sent.\n'
              f'Inherited proxy settings: {proxy_summary()}',file=sys.stderr)
        return 2
    try:
        # Check the unauthenticated dependency before requesting any secret.
        catalog=load_catalog()
        key=os.environ.get('RIOT_API_KEY','').strip()
        if not key:
            try:
                key=load_saved_riot_key()
                if key:
                    print('Using the Riot key saved for your Windows account.',flush=True)
            except (OSError, ValueError):
                print('Could not read the saved key. Run SAVE-RIOT-KEY.cmd to replace it, or enter a key for this run.',file=sys.stderr)
        if not key and sys.stdin.isatty():
            import getpass
            key=getpass.getpass('Riot API key (hidden; kept in memory only): ').strip()
        if not key:
            print('Run in a terminal to enter your key privately, or set RIOT_API_KEY in your environment.',file=sys.stderr)
            return 2
        key=validate_key_input(key)
        if args.diagnose:
            print(f'Key input: {len(key)} characters; expected format; no control characters. Value not displayed.',flush=True)
            print(f'Proxy configuration: {proxy_summary()}',flush=True)
        client=RiotClient(key,http_client=args.http_client)
        if args.diagnose:
            diagnose(args,client,catalog)
            return 0
        while True:
            (collect_resumable if args.resume else collect)(args,client,catalog)
            if not args.watch_minutes:
                return 0
            print(f'Waiting {args.watch_minutes:g} minutes before refresh.',flush=True)
            time.sleep(args.watch_minutes*60)
            catalog=load_catalog()
    except (KeyboardInterrupt,EOFError):
        print('Collector stopped. Cached matches are preserved.',file=sys.stderr)
        return 130
    except (RuntimeError,ValueError,OSError,KeyError,sqlite3.Error) as exc:
        print(f'Collection failed: {exc}',file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
