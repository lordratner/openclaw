import hashlib,json,os,shutil,tarfile
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'nextcloud-silent-package'
previous=Path('.retained-native/nextcloud-silent-package')
identity=json.loads((previous/'package-identity.json').read_text())
assert identity['source']==os.environ['SOURCE_SHA']
assert identity['packageSha256']=='4966a72bd6a30bc4da9c9cb386ece8fefe0ab8b0a22e2c15fc00aff2f4c71ff7'
package=root/'silent-sends.tgz'
assert hashlib.sha256(package.read_bytes()).hexdigest()==identity['packageSha256']
q=json.loads(Path('.retained-qualification/qualification.json').read_text())
assert q['status']=='PASS' and q['source']==identity['source']
assert q['sourceHashes']==identity['sourceHashes']
for name,digest in q['sourceHashes'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
with tarfile.open(package) as archive:assert json.load(archive.extractfile('package/dist/build-info.json'))['commit']==identity['source']
for name in ['package-identity.json','retained-qualification.json']:shutil.copyfile(previous/name,root/name)
(root/'retained-package-admission.json').write_text(json.dumps({'status':'PASS','source':identity['source'],'packageSha256':identity['packageSha256'],'retainedBuildRun':39710201330},indent=2))
