export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_type: string;
          actor_user_id: string | null;
          company_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: number;
          ip: unknown;
          metadata: NonNullable<Json>;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_type: string;
          actor_user_id?: string | null;
          company_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          ip?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_type?: string;
          actor_user_id?: string | null;
          company_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          ip?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_steps: {
        Row: {
          body_template: string;
          campaign_id: string;
          company_id: string;
          created_at: string;
          delay_days: number;
          id: string;
          step_number: number;
          strip_diacritics: boolean;
        };
        Insert: {
          body_template: string;
          campaign_id: string;
          company_id: string;
          created_at?: string;
          delay_days?: number;
          id?: string;
          step_number: number;
          strip_diacritics?: boolean;
        };
        Update: {
          body_template?: string;
          campaign_id?: string;
          company_id?: string;
          created_at?: string;
          delay_days?: number;
          id?: string;
          step_number?: number;
          strip_diacritics?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      campaigns: {
        Row: {
          approval_comment: string | null;
          approved_at: string | null;
          approved_by: string | null;
          approved_recipient_count: number | null;
          attribution_window_days: number;
          automation_rule_id: string | null;
          avg_job_value_minor_snapshot: number | null;
          channel: string;
          company_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          expected_conversion_rate: number;
          holdout_pct: number;
          id: string;
          name: string;
          offer_text: string | null;
          scheduled_at: string | null;
          segment_id: string | null;
          segment_preset: string | null;
          segment_rules_snapshot: NonNullable<Json>;
          status: Database["public"]["Enums"]["campaign_status"];
          submitted_at: string | null;
          submitted_by: string | null;
          updated_at: string;
        };
        Insert: {
          approval_comment?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_recipient_count?: number | null;
          attribution_window_days?: number;
          automation_rule_id?: string | null;
          avg_job_value_minor_snapshot?: number | null;
          channel?: string;
          company_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_conversion_rate?: number;
          holdout_pct?: number;
          id?: string;
          name: string;
          offer_text?: string | null;
          scheduled_at?: string | null;
          segment_id?: string | null;
          segment_preset?: string | null;
          segment_rules_snapshot: NonNullable<Json>;
          status?: Database["public"]["Enums"]["campaign_status"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Update: {
          approval_comment?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_recipient_count?: number | null;
          attribution_window_days?: number;
          automation_rule_id?: string | null;
          avg_job_value_minor_snapshot?: number | null;
          channel?: string;
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_conversion_rate?: number;
          holdout_pct?: number;
          id?: string;
          name?: string;
          offer_text?: string | null;
          scheduled_at?: string | null;
          segment_id?: string | null;
          segment_preset?: string | null;
          segment_rules_snapshot?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["campaign_status"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_segment_id_company_id_fkey";
            columns: ["segment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "segments";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      companies: {
        Row: {
          address_line: string | null;
          average_job_value_minor: number;
          city: string | null;
          contact_person: string | null;
          country: string;
          created_at: string;
          default_locale: string;
          default_sender_name: string | null;
          dic: string | null;
          dpa_document_path: string | null;
          dpa_signed_at: string | null;
          email: string | null;
          ico: string | null;
          id: string;
          lifecycle_computed_at: string | null;
          logo_path: string | null;
          name: string;
          opening_hours: NonNullable<Json>;
          phone: string | null;
          postal_code: string | null;
          preferred_channel: string;
          requires_client_approval: boolean;
          sending_enabled: boolean;
          service_mode: Database["public"]["Enums"]["service_mode"];
          settings: NonNullable<Json>;
          status: string;
          timezone: string;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address_line?: string | null;
          average_job_value_minor?: number;
          city?: string | null;
          contact_person?: string | null;
          country?: string;
          created_at?: string;
          default_locale?: string;
          default_sender_name?: string | null;
          dic?: string | null;
          dpa_document_path?: string | null;
          dpa_signed_at?: string | null;
          email?: string | null;
          ico?: string | null;
          id?: string;
          lifecycle_computed_at?: string | null;
          logo_path?: string | null;
          name: string;
          opening_hours?: NonNullable<Json>;
          phone?: string | null;
          postal_code?: string | null;
          preferred_channel?: string;
          requires_client_approval?: boolean;
          sending_enabled?: boolean;
          service_mode?: Database["public"]["Enums"]["service_mode"];
          settings?: NonNullable<Json>;
          status?: string;
          timezone?: string;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address_line?: string | null;
          average_job_value_minor?: number;
          city?: string | null;
          contact_person?: string | null;
          country?: string;
          created_at?: string;
          default_locale?: string;
          default_sender_name?: string | null;
          dic?: string | null;
          dpa_document_path?: string | null;
          dpa_signed_at?: string | null;
          email?: string | null;
          ico?: string | null;
          id?: string;
          lifecycle_computed_at?: string | null;
          logo_path?: string | null;
          name?: string;
          opening_hours?: NonNullable<Json>;
          phone?: string | null;
          postal_code?: string | null;
          preferred_channel?: string;
          requires_client_approval?: boolean;
          sending_enabled?: boolean;
          service_mode?: Database["public"]["Enums"]["service_mode"];
          settings?: NonNullable<Json>;
          status?: string;
          timezone?: string;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          company_id: string;
          created_at: string;
          eligibility_reason: string | null;
          email: string | null;
          external_id: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          last_visit_at: string | null;
          legal_basis: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at: string | null;
          legal_basis_source: string | null;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor: number;
          notes: string | null;
          phone_e164: string | null;
          phone_type: string;
          search_name: string | null;
          source_import_id: string | null;
          updated_at: string;
          visit_count: number;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          eligibility_reason?: string | null;
          email?: string | null;
          external_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          last_visit_at?: string | null;
          legal_basis?: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at?: string | null;
          legal_basis_source?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor?: number;
          notes?: string | null;
          phone_e164?: string | null;
          phone_type?: string;
          search_name?: never;
          source_import_id?: string | null;
          updated_at?: string;
          visit_count?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          eligibility_reason?: string | null;
          email?: string | null;
          external_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          last_visit_at?: string | null;
          legal_basis?: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at?: string | null;
          legal_basis_source?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor?: number;
          notes?: string | null;
          phone_e164?: string | null;
          phone_type?: string;
          search_name?: never;
          source_import_id?: string | null;
          updated_at?: string;
          visit_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      import_mapping_templates: {
        Row: {
          company_id: string;
          mapping: NonNullable<Json>;
          type: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          mapping: NonNullable<Json>;
          type: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          mapping?: NonNullable<Json>;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_mapping_templates_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      import_rows: {
        Row: {
          company_id: string;
          id: number;
          import_id: string;
          issues: NonNullable<Json>;
          match_customer_id: string | null;
          normalized: Json | null;
          raw: NonNullable<Json>;
          row_number: number;
          status: string;
        };
        Insert: {
          company_id: string;
          id?: never;
          import_id: string;
          issues?: NonNullable<Json>;
          match_customer_id?: string | null;
          normalized?: Json | null;
          raw: NonNullable<Json>;
          row_number: number;
          status?: string;
        };
        Update: {
          company_id?: string;
          id?: never;
          import_id?: string;
          issues?: NonNullable<Json>;
          match_customer_id?: string | null;
          normalized?: Json | null;
          raw?: NonNullable<Json>;
          row_number?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_company_id_fkey";
            columns: ["import_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      imports: {
        Row: {
          company_id: string;
          completed_at: string | null;
          counts: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          delimiter: string | null;
          encoding: string | null;
          error: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size_bytes: number | null;
          header: NonNullable<Json>;
          id: string;
          legal_basis_confirmed_at: string | null;
          legal_basis_confirmed_by: string | null;
          legal_basis_declared: Database["public"]["Enums"]["legal_basis"] | null;
          mapping: Json | null;
          preview: NonNullable<Json>;
          progress: NonNullable<Json>;
          row_count: number;
          sheet: string | null;
          sheet_names: NonNullable<Json>;
          status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          completed_at?: string | null;
          counts?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delimiter?: string | null;
          encoding?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size_bytes?: number | null;
          header?: NonNullable<Json>;
          id?: string;
          legal_basis_confirmed_at?: string | null;
          legal_basis_confirmed_by?: string | null;
          legal_basis_declared?: Database["public"]["Enums"]["legal_basis"] | null;
          mapping?: Json | null;
          preview?: NonNullable<Json>;
          progress?: NonNullable<Json>;
          row_count?: number;
          sheet?: string | null;
          sheet_names?: NonNullable<Json>;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          completed_at?: string | null;
          counts?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delimiter?: string | null;
          encoding?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size_bytes?: number | null;
          header?: NonNullable<Json>;
          id?: string;
          legal_basis_confirmed_at?: string | null;
          legal_basis_confirmed_by?: string | null;
          legal_basis_declared?: Database["public"]["Enums"]["legal_basis"] | null;
          mapping?: Json | null;
          preview?: NonNullable<Json>;
          progress?: NonNullable<Json>;
          row_count?: number;
          sheet?: string | null;
          sheet_names?: NonNullable<Json>;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "imports_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          company_id: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["company_role"];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          company_id: string;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by?: string | null;
          role: Database["public"]["Enums"]["company_role"];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          company_id?: string;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["company_role"];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["company_role"];
          user_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["company_role"];
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["company_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          locale: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          locale?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          locale?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      segments: {
        Row: {
          archived_at: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          preset_key: string | null;
          rules: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          preset_key?: string | null;
          rules: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          preset_key?: string | null;
          rules?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "segments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      service_category_mappings: {
        Row: {
          category: Database["public"]["Enums"]["service_category"];
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          raw_value_norm: string;
        };
        Insert: {
          category: Database["public"]["Enums"]["service_category"];
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          raw_value_norm: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["service_category"];
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          raw_value_norm?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_category_mappings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          brand: string | null;
          company_id: string;
          created_at: string;
          customer_id: string;
          id: string;
          last_visit_at: string | null;
          license_plate_display: string | null;
          license_plate_norm: string | null;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          model: string | null;
          model_year: number | null;
          updated_at: string;
          vin: string | null;
        };
        Insert: {
          brand?: string | null;
          company_id: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          last_visit_at?: string | null;
          license_plate_display?: string | null;
          license_plate_norm?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          model?: string | null;
          model_year?: number | null;
          updated_at?: string;
          vin?: string | null;
        };
        Update: {
          brand?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          last_visit_at?: string | null;
          license_plate_display?: string | null;
          license_plate_norm?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          model?: string | null;
          model_year?: number | null;
          updated_at?: string;
          vin?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      visits: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string;
          external_ref: string | null;
          id: string;
          job_value_minor: number | null;
          service_category: Database["public"]["Enums"]["service_category"];
          service_label_norm: string | null;
          service_type_raw: string | null;
          source_import_id: string | null;
          vehicle_id: string | null;
          visited_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          customer_id: string;
          external_ref?: string | null;
          id?: string;
          job_value_minor?: number | null;
          service_category?: Database["public"]["Enums"]["service_category"];
          service_label_norm?: never;
          service_type_raw?: string | null;
          source_import_id?: string | null;
          vehicle_id?: string | null;
          visited_at: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          external_ref?: string | null;
          id?: string;
          job_value_minor?: number | null;
          service_category?: Database["public"]["Enums"]["service_category"];
          service_label_norm?: never;
          service_type_raw?: string | null;
          source_import_id?: string | null;
          vehicle_id?: string | null;
          visited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "visits_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "visits_vehicle_id_company_id_fkey";
            columns: ["vehicle_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      commit_import_batch: {
        Args: { p_batch: number; p_company_id: string; p_import_id: string; p_payload: Json };
        Returns: Json;
      };
      job_value_median: {
        Args: { p_categories: Database["public"]["Enums"]["service_category"][]; p_company_id: string };
        Returns: {
          median_minor: number;
          visits: number;
        }[];
      };
      list_customers: {
        Args: {
          p_category?: Database["public"]["Enums"]["service_category"];
          p_company_id: string;
          p_digits?: string;
          p_eligibility?: string;
          p_last_visit?: string;
          p_limit?: number;
          p_lookback_months?: number;
          p_name?: string;
          p_offset?: number;
          p_plate?: string;
          p_status?: Database["public"]["Enums"]["lifecycle_status"];
          p_today: string;
        };
        Returns: {
          first_name: string;
          id: string;
          last_name: string;
          last_visit_at: string;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          phone_e164: string;
          phone_type: string;
          plate: string;
          total_count: number;
          vehicle: string;
          vehicle_count: number;
          visit_count: number;
        }[];
      };
      list_service_labels: {
        Args: { p_company_id: string };
        Returns: {
          category: Database["public"]["Enums"]["service_category"];
          example: string;
          label_norm: string;
          mapped: boolean;
          visits: number;
        }[];
      };
      recompute_lifecycle: {
        Args: { p_company_id: string; p_customer_ids?: string[]; p_today?: string };
        Returns: number;
      };
      segment_audience: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: {
          customer_id: string;
          last_visit_at: string;
          reason: string;
          vehicle_id: string;
        }[];
      };
      segment_preview: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: Json;
      };
      segment_recipients: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: {
          customer_id: string;
          first_name: string;
          last_name: string;
          last_visit_at: string;
          plate: string;
          vehicle_brand: string;
          vehicle_id: string;
          vehicle_model: string;
        }[];
      };
      set_import_row_results: { Args: { p_company_id: string; p_import_id: string; p_rows: Json }; Returns: number };
      set_service_category: {
        Args: {
          p_category: Database["public"]["Enums"]["service_category"];
          p_company_id: string;
          p_label_norm: string;
        };
        Returns: number;
      };
    };
    Enums: {
      campaign_status:
        | "draft"
        | "waiting_for_approval"
        | "scheduled"
        | "sending"
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
        | "failed";
      company_role: "shop_owner" | "shop_manager";
      conversion_stage: "contacted" | "replied" | "booked" | "completed" | "lost" | "opted_out";
      legal_basis: "consent" | "existing_customer" | "unknown";
      lifecycle_status: "active" | "at_risk" | "inactive" | "reactivated" | "opted_out";
      service_category:
        | "regular_service"
        | "oil_change"
        | "tyre_change"
        | "tyre_storage"
        | "ac_service"
        | "brakes"
        | "diagnostics"
        | "stk"
        | "repair_other";
      service_mode: "managed" | "self_service";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      campaign_status: [
        "draft",
        "waiting_for_approval",
        "scheduled",
        "sending",
        "active",
        "paused",
        "completed",
        "cancelled",
        "failed",
      ],
      company_role: ["shop_owner", "shop_manager"],
      conversion_stage: ["contacted", "replied", "booked", "completed", "lost", "opted_out"],
      legal_basis: ["consent", "existing_customer", "unknown"],
      lifecycle_status: ["active", "at_risk", "inactive", "reactivated", "opted_out"],
      service_category: [
        "regular_service",
        "oil_change",
        "tyre_change",
        "tyre_storage",
        "ac_service",
        "brakes",
        "diagnostics",
        "stk",
        "repair_other",
      ],
      service_mode: ["managed", "self_service"],
    },
  },
} as const;
