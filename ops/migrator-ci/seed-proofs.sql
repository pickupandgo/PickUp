-- Historical synthetic receipt fixtures, NOT API verification receipts or real photos.
INSERT INTO delivery_proofs(id,payment_trip_id,engine_trip_id,engine_stop_id,sequence,owner_subject,key,content_type,size_bytes,checksum_sha256,storage_version_id,storage_etag,verified_at)
VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000006',gen_random_uuid(),gen_random_uuid(),1,'ci-driver','synthetic/pending','image/png',100,NULL,NULL,NULL,NULL),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000006',gen_random_uuid(),gen_random_uuid(),2,'ci-driver','synthetic/historical','image/png',100,repeat('a',64),'historical-version','historical-etag',now()),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000006',gen_random_uuid(),gen_random_uuid(),3,'ci-driver','synthetic/legacy-noncanonical','image/png',100,'legacy-noncanonical-hash','legacy-version','legacy-etag',now());
