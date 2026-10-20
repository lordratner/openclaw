#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
proof="$RUNNER_TEMP/nextcloud-voice-live"
mkdir -p "$proof/evidence" "$proof/app"
docker run --detach --name nextcloud-voice-proof \
  --add-host host.docker.internal:host-gateway \
  --publish 127.0.0.1:18080:80 \
  --env NEXTCLOUD_ADMIN_USER=outbound-proof \
  --env NEXTCLOUD_ADMIN_PASSWORD=nextcloud-disposable-proof-password \
  --env SQLITE_DATABASE=nextcloud \
  --env NEXTCLOUD_TRUSTED_DOMAINS=127.0.0.1 \
  nextcloud@sha256:74c22796c8ff5537dd564394b47951cb90e4aa5e0f11467d062c539bb036bc35 \
  > "$proof/evidence/container-id.txt"
ready=0
for attempt in $(seq 1 120); do
  if curl --silent --fail http://127.0.0.1:18080/status.php | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("installed") else 1)' 2>/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" = 1
curl --fail --location --silent --show-error \
  https://github.com/nextcloud-releases/spreed/releases/download/v25.0.6/spreed-v25.0.6.tar.gz \
  --output "$proof/spreed.tar.gz"
printf '%s  %s\n' 2b3e3eae42d9bf8ba8da2ab244d16347a3cfacbb8bff346bd99cf32cd6f9c65e "$proof/spreed.tar.gz" | sha256sum --check
tar --extract --gzip --file "$proof/spreed.tar.gz" --directory "$proof/app"
docker cp "$proof/app/spreed" nextcloud-voice-proof:/var/www/html/custom_apps/spreed
docker exec nextcloud-voice-proof chown -R www-data:www-data /var/www/html/custom_apps/spreed
docker exec --user www-data nextcloud-voice-proof php occ app:enable spreed > "$proof/evidence/talk-enable.log"
docker exec --user www-data nextcloud-voice-proof php occ config:system:set trusted_domains 1 --value=127.0.0.1:18080
docker exec --user www-data --env OC_PASS=nextcloud-disposable-proof-password nextcloud-voice-proof php occ user:add --password-from-env outbound-recipient > "$proof/evidence/recipient-create.log"
docker exec --user www-data nextcloud-voice-proof php occ status --output=json > "$proof/evidence/nextcloud-version.json"
docker exec --user www-data nextcloud-voice-proof php occ app:list --output=json > "$proof/evidence/apps.json"

docker exec --user www-data nextcloud-voice-proof php occ config:app:set firstrunwizard wizard_enabled --value=0 --type=boolean > "$proof/evidence/disable-disposable-ui-tour.log"
