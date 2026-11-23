-- CI ONLY: inserted after migration 5, before customer/quote backfills. No trigger is disabled.
INSERT INTO users(id,phone,role) VALUES
 ('00000000-0000-4000-8000-000000000001','+15555551101','CUSTOMER'),
 ('00000000-0000-4000-8000-000000000002','+15555551102','DRIVER');
INSERT INTO drivers(id,user_id) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
INSERT INTO fee_rules(id,rule_type,value,effective_from,reason) VALUES
 ('00000000-0000-4000-8000-000000000004','PERCENTAGE',10,now()-interval '1 day','Synthetic migration preservation fixture');
INSERT INTO bookings(id,external_ref,customer_id,fare_estimate_minor,final_fare_minor,payment_method,fee_rule_id,confirmed_at) VALUES
 ('00000000-0000-4000-8000-000000000005','MIGRATOR-CI-SYNTHETIC','00000000-0000-4000-8000-000000000001',10000,10000,'PAY_AT_PICKUP','00000000-0000-4000-8000-000000000004',now());
INSERT INTO trips(id,booking_id,driver_id) VALUES
 ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003');
