--
-- PostgreSQL database cluster dump
--

\restrict XwefvNcngfmrjKeO8xCMTr1GZSgcJKMqY9k2kOwUV51ZuYe4QG42kemHEMYz9Um

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE cmv;
ALTER ROLE cmv WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:A67VBZZXwKT20n6ctLoKIQ==$Q6xYtyFZDjuQp/vS4tpbHEWkh30N0TFFj884PRe+gPU=:Wd/cgE45ell/0qjhyJDWeeRyojqEBasrAhmigeWujEE=';

--
-- User Configurations
--








\unrestrict XwefvNcngfmrjKeO8xCMTr1GZSgcJKMqY9k2kOwUV51ZuYe4QG42kemHEMYz9Um

--
-- PostgreSQL database cluster dump complete
--

