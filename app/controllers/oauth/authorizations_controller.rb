# frozen_string_literal: true

class Oauth::AuthorizationsController < Doorkeeper::AuthorizationsController
  skip_before_action :authenticate_resource_owner!

  before_action :store_current_location, only: :new
  before_action :handle_multi_account_force_login
  before_action :authenticate_resource_owner!

  content_security_policy do |p|
    p.form_action(false)
  end

  include Localized

  private

  # `only: :new` is the whole point. This hook used to run on `create` (the
  # consent POST) and `destroy` (the deny DELETE) as well. Neither carries a
  # query string, so `user_return_to` ended up holding a bare
  # `/oauth/authorize`, and any later sign-in was sent there, where Doorkeeper
  # answers "missing required parameter: client_id".
  #
  # POST and DELETE have already cleared `authenticate_resource_owner!`, so
  # there is no reason to record a place to come back to. In the rare case
  # where the session died in between, the user lands on home instead of the
  # consent screen - better than a broken link.
  def store_current_location
    store_location_for(:user, request.url)
  end

  def render_success
    if skip_authorization? || (matching_token? && !truthy_param?('force_login'))
      redirect_or_render authorize_response
    elsif Doorkeeper.configuration.api_only
      render json: pre_auth
    else
      render :new
    end
  end

  def truthy_param?(key)
    ActiveModel::Type::Boolean.new.cast(params[key])
  end

  def multi_account_force_login_requested?
    truthy_param?('force_login') || params[:prompt] == 'login'
  end

  def multi_account_state_data
    return @multi_account_state_data if defined?(@multi_account_state_data)

    state = params[:state]
    @multi_account_state_data =
      if state.present?
        MultiAccounts::StateStore.fetch(state)
      else
        nil
      end
  rescue StandardError => e
    Rails.logger.warn("Multi-account force login state fetch failed: #{e.message}")
    @multi_account_state_data = nil
  end

  def handle_multi_account_force_login
    return unless multi_account_force_login_requested?

    state_data = multi_account_state_data
    return unless state_data.present?
    return unless state_data[:user_id].present?

    return unless user_signed_in? && current_user.id == state_data[:user_id].to_i
    return if state_data[:force_login_performed]

    MultiAccounts::StateStore.mark_force_login!(params[:state])
    @multi_account_state_data = state_data.merge(force_login_performed: true)
    sign_out(:user)
    store_location_for(:user, request.original_fullpath)

    # This marker must always carry a timestamp.
    #
    # It is not only the popup that gets signed out here. The popup and the
    # main tab share the session cookie, so the main tab goes with it. If the
    # user simply closes the popup at the login screen, all that is left in
    # the session is "signed out, and go back to this authorize URL". Signing
    # in on the main screen much later then dragged the user to an OAuth
    # consent screen instead of home. The timestamp lets
    # `Auth::SessionsController#after_sign_in_path_for` throw away a stale
    # marker.
    session[:multi_account_return_to] = request.original_fullpath
    session[:multi_account_return_to_at] = Time.now.utc.to_i
  end
end
