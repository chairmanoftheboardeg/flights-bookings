# booking.emiratesgrouproblox.link

Passenger portal for bookings and online check-in (static site).

## Features
- Supabase Auth (email/password)
- Search flights (public RPC)
- Create booking (RPC)
- Request online check-in (RPC)
- View passenger alerts
- Boarding pass modal (shown after check-in approval)

## Backend expectations
RPC functions:
- egr_get_public_flights(p_date date)
- egr_create_booking(p_flight_id uuid)
- egr_request_online_checkin(p_booking_id uuid, p_requested_seat text)

Tables queried (RLS must allow passenger reads):
- egr_bookings, egr_checkin_requests, egr_checkins, egr_alerts

## Deploy
Upload to your GitHub Pages repo root for booking.emiratesgrouproblox.link.
