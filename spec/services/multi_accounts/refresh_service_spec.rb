# frozen_string_literal: true

require 'rails_helper'

RSpec.describe MultiAccounts::RefreshService do
  subject(:service_call) { described_class.new(refresh_token: refresh_token, request: request).call }

  let(:request) { instance_double(ActionDispatch::Request, remote_ip: '127.0.0.1') }
  let(:application) { Doorkeeper::Application.create!(name: 'MultiAccount', redirect_uri: 'https://example.com/callback') }
  let(:user) { Fabricate(:user) }
  let(:refresh_token_record) do
    Fabricate(
      :access_token,
      application: application,
      resource_owner_id: user.id,
      scopes: 'read',
      multi_account: true,
      purpose: 'multi_account_refresh',
      long_lived: true,
      revoked_at: nil
    )
  end
  let(:refresh_token) { refresh_token_record.token }
  let(:rate_limiter) { instance_double(RateLimiter, record!: true, rollback!: true) }

  before do
    allow(RateLimiter).to receive(:new).and_return(rate_limiter)
    allow(request).to receive(:remote_ip).and_return('127.0.0.1')
  end

  describe '#call' do
    context 'with a valid long-lived refresh token' do
      it 'creates a new session token with multi-account flag' do
        result = service_call

        expect(result.access_token).to be_persisted
        expect(result.access_token.multi_account).to be(true)
        expect(result.access_token.long_lived).to be(false)
        expect(result.access_token.purpose).to eq('multi_account_session')
        expect(result.access_token.resource_owner_id).to eq(user.id)
        expect(result.account).to eq(user.account)
        expect(RateLimiter).to have_received(:new).with(user, family: :multi_account_refresh)
        expect(rate_limiter).to have_received(:record!)
      end
    end

    context 'when the refresh token is invalid' do
      let(:refresh_token) { 'invalid' }

      it 'raises an error with status 401' do
        expect { service_call }.to raise_error(MultiAccounts::RefreshService::Error) { |error|
          expect(error.status).to eq(401)
        }
      end
    end

    context 'when the refresh token is not long-lived' do
      before do
        refresh_token_record.update!(long_lived: false, purpose: nil)
      end

      # Regression: while the auto-upgrade only looked at the `multi_account`
      # flag it promoted tokens issued by other applications too, which left
      # this example silently broken.
      it 'raises an error with status 422' do
        expect { service_call }.to raise_error(MultiAccounts::RefreshService::Error) { |error|
          expect(error.status).to eq(422)
        }
      end

      it 'does not upgrade the token' do
        expect { service_call }.to raise_error(MultiAccounts::RefreshService::Error)

        expect(refresh_token_record.reload).to have_attributes(long_lived: false, purpose: nil)
      end

      context 'when the token was issued by the multi-account application' do
        around do |example|
          original = Rails.configuration.x.multi_account.dup
          Rails.configuration.x.multi_account[:client_id] = application.uid
          example.run
          Rails.configuration.x.multi_account = ActiveSupport::HashWithIndifferentAccess.new(original)
        end

        # Older versions of `consume` did not set the flags. Those tokens
        # must keep working.
        it 'upgrades the legacy token instead of rejecting it' do
          expect { service_call }.to_not raise_error

          expect(refresh_token_record.reload).to have_attributes(
            long_lived: true,
            purpose: 'multi_account_refresh',
            multi_account: true
          )
        end
      end
    end

    # A session token handed out by a switch belongs to the multi-account
    # application with `multi_account: true`, so without the marker the
    # auto-upgrade turns it into a ten-year refresh token. `revoke_access!`
    # skips those, so logout never clears them - and one is created on every
    # switch.
    context 'when a session token from a previous switch is replayed' do
      around do |example|
        original = Rails.configuration.x.multi_account.dup
        Rails.configuration.x.multi_account[:client_id] = application.uid
        example.run
        Rails.configuration.x.multi_account = ActiveSupport::HashWithIndifferentAccess.new(original)
      end

      let(:session_token_record) do
        described_class.new(refresh_token: refresh_token, request: request).call.access_token
      end

      it 'refuses to accept it as a refresh token' do
        replayed = described_class.new(refresh_token: session_token_record.token, request: request)

        expect { replayed.call }.to raise_error(MultiAccounts::RefreshService::Error) { |error|
          expect(error.status).to eq(422)
        }

        expect(session_token_record.reload).to have_attributes(long_lived: false, purpose: 'multi_account_session')
      end
    end
  end
end

