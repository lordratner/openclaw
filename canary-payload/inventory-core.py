import hashlib
import json
import os
from pathlib import Path

proof=Path(os.environ['RUNNER_TEMP'])/'release-canary-proof'
def inventory(root):
    return {str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(root.rglob('*')) if p.is_file() and 'node_modules' not in p.parts}
stock=inventory(proof/'core-stock-dist')
seam=inventory(proof/'core-seam-dist')
changed=[p for p in stock.keys()|seam.keys() if stock.get(p)!=seam.get(p)]
report={'state':'COMPILED_COMPARISON_NOT_APPROVED_FOR_LIVE_SWAP','stock':stock,'candidate_seam':seam,'changed_paths':sorted(changed),'changed_count':len(changed),'review_required':'Trace each changed hashed runtime chunk and its reverse importers. Compare unchanged dependency closure with installed official stock. Reject unrelated content, unsafe identity/singleton changes or a broad core replacement. Build stamps and other non-runtime generated output are not automatically live swap files.'}
(proof/'core-artifact-boundary.json').write_text(json.dumps(report,indent=2)+'\n')
